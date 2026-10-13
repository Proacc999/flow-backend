const {
  createMetaFlow,
  deleteMetaFlow,
  getMetaFlowJson,
  listMetaFlows,
  publishMetaFlow,
  sendMetaFlowMessage,
  updateMetaFlowJson,
  updateMetaFlowMetadata,
} = require("../services/meta-flow.service");
const { Flow, toClientFlow } = require("../models/flow.model");

async function createFlow(req, res, next) {
  try {
    console.log("[Create Flow] validated request received", {
      name: req.validatedBody.name,
      categories: req.validatedBody.categories,
      wabaNumber: req.validatedBody.wabaNumber,
      flowJsonVersion: req.validatedBody.flowJson.version,
    });

    const metaFlow = await createMetaFlow(req.validatedBody);
    let savedFlow;

    try {
      savedFlow = await Flow.create({
        metaFlowId: metaFlow.id,
        name: metaFlow.name,
        categories: metaFlow.categories,
        wabaId: metaFlow.wabaId,
        wabaNumber: metaFlow.wabaNumber,
        status: metaFlow.status,
        valid: metaFlow.valid,
        validationErrors: metaFlow.validationErrors,
        flowJson: req.validatedBody.flowJson,
      });
    } catch (databaseError) {
      databaseError.code = "DATABASE_SAVE_FAILED";
      databaseError.statusCode = 500;
      databaseError.metaFlowId = metaFlow.id;
      throw databaseError;
    }

    const flow = toClientFlow(savedFlow);

    return res.status(201).json({
      success: true,
      message: flow.valid
        ? "Flow created successfully as a Meta draft."
        : "Flow was created as a Meta draft, but its JSON has validation errors.",
      flow,
    });
  } catch (error) {
    next(error);
  }
}

async function getAllFlows(req, res, next) {
  try {
    const { flows: metaFlows } = await listMetaFlows({
      wabaNumber: req.query.wabaNumber,
    });

    if (metaFlows.length > 0) {
      await Flow.bulkWrite(
        metaFlows.map((flow) => ({
          updateOne: {
            filter: { metaFlowId: flow.id },
            update: {
              $set: {
                name: flow.name,
                categories: flow.categories,
                wabaId: flow.wabaId,
                wabaNumber: flow.wabaNumber,
                status: flow.status,
                valid: flow.valid,
                validationErrors: flow.validationErrors,
                jsonVersion: flow.jsonVersion,
              },
              $setOnInsert: { flowJson: null },
            },
            upsert: true,
          },
        })),
      );
    }

    const metaFlowIds = metaFlows.map((flow) => flow.id);
    const query = metaFlowIds.length
      ? { metaFlowId: { $in: metaFlowIds } }
      : { metaFlowId: { $in: [] } };
    const flows = await Flow.find(query).sort({ createdAt: -1 }).lean();

    return res.json({
      success: true,
      source: "meta-synced-to-db",
      count: flows.length,
      data: flows.map(toClientFlow),
    });
  } catch (error) {
    next(error);
  }
}

async function getFlowDetails(req, res, next) {
  try {
    const metaFlowId = String(req.params.flowId);
    const savedFlow = await Flow.findOne({ metaFlowId });

    if (!savedFlow) {
      const error = new Error(`Flow ${metaFlowId} was not found in MongoDB.`);
      error.code = "FLOW_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    let flowJson = savedFlow.flowJson;
    let source = "mongodb";

    if (!flowJson) {
      flowJson = await getMetaFlowJson({
        flowId: metaFlowId,
        wabaNumber: savedFlow.wabaNumber,
      });
      savedFlow.flowJson = flowJson;
      savedFlow.jsonVersion = flowJson.version || savedFlow.jsonVersion;
      await savedFlow.save();
      source = "meta-cached-to-mongodb";
    }

    return res.json({
      success: true,
      source,
      data: {
        ...toClientFlow(savedFlow),
        flowJson,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function findSavedFlow(metaFlowId) {
  const savedFlow = await Flow.findOne({ metaFlowId });
  if (savedFlow) return savedFlow;

  const error = new Error(`Flow ${metaFlowId} was not found in MongoDB.`);
  error.code = "FLOW_NOT_FOUND";
  error.statusCode = 404;
  throw error;
}

async function getOrFetchFlowJson(savedFlow) {
  if (savedFlow.flowJson) return savedFlow.flowJson;

  const flowJson = await getMetaFlowJson({
    flowId: savedFlow.metaFlowId,
    wabaNumber: savedFlow.wabaNumber,
  });
  savedFlow.flowJson = flowJson;
  savedFlow.jsonVersion = flowJson.version || savedFlow.jsonVersion;
  await savedFlow.save();
  return flowJson;
}

function createExportFilename(name) {
  const safeName = String(name || "flow")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .trim()
    .replace(/[. ]+$/g, "");
  return `${safeName || "flow"}.json`;
}

async function exportFlowJson(req, res, next) {
  try {
    const metaFlowId = String(req.params.flowId);
    const savedFlow = await findSavedFlow(metaFlowId);
    const flowJson = await getOrFetchFlowJson(savedFlow);
    const filename = createExportFilename(savedFlow.name);
    const asciiFilename = filename.replace(/[^\x20-\x7E]/g, "_");

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    return res.status(200).send(JSON.stringify(flowJson, null, 2));
  } catch (error) {
    next(error);
  }
}

async function publishFlow(req, res, next) {
  try {
    const metaFlowId = String(req.params.flowId);
    const savedFlow = await findSavedFlow(metaFlowId);

    if (savedFlow.status === "PUBLISHED") {
      return res.json({
        success: true,
        message: "Flow is already published.",
        flow: toClientFlow(savedFlow),
      });
    }

    await publishMetaFlow({
      flowId: metaFlowId,
      wabaNumber: savedFlow.wabaNumber,
    });

    savedFlow.status = "PUBLISHED";
    await savedFlow.save();

    return res.json({
      success: true,
      message: "Flow published successfully.",
      flow: toClientFlow(savedFlow),
    });
  } catch (error) {
    next(error);
  }
}

async function deleteFlow(req, res, next) {
  try {
    const metaFlowId = String(req.params.flowId);
    const savedFlow = await findSavedFlow(metaFlowId);

    if (savedFlow.status !== "DRAFT") {
      const error = new Error(
        `Only DRAFT flows can be deleted. This Flow is ${savedFlow.status}.`,
      );
      error.code = "FLOW_NOT_DELETABLE";
      error.statusCode = 409;
      throw error;
    }

    await deleteMetaFlow({
      flowId: metaFlowId,
      wabaNumber: savedFlow.wabaNumber,
    });
    await Flow.deleteOne({ metaFlowId });

    return res.json({
      success: true,
      message: "Flow deleted successfully.",
      flowId: metaFlowId,
    });
  } catch (error) {
    next(error);
  }
}

async function sendFlow(req, res, next) {
  try {
    const metaFlowId = String(req.params.flowId);
    const savedFlow = await findSavedFlow(metaFlowId);
    const isPublished = savedFlow.status === "PUBLISHED";

    if (!isPublished && savedFlow.status !== "DRAFT") {
      const error = new Error(
        `Flows with status ${savedFlow.status} cannot be sent.`,
      );
      error.code = "FLOW_NOT_SENDABLE";
      error.statusCode = 409;
      throw error;
    }

    const { recipientNumber, screenId } = req.validatedBody;
    const bodyText = isPublished
      ? req.validatedBody.bodyText
      : req.validatedBody.bodyText || "This is a test message to try your Flow.";
    const ctaText = isPublished
      ? req.validatedBody.ctaText
      : req.validatedBody.ctaText || "Start testing your Flow";

    if (isPublished && (!bodyText || !ctaText)) {
      const error = new Error(
        "Message body and CTA button text are required for a published Flow.",
      );
      error.code = "SEND_FIELDS_REQUIRED";
      error.statusCode = 400;
      throw error;
    }

    const result = await sendMetaFlowMessage({
      flowId: metaFlowId,
      flowName: savedFlow.name,
      wabaNumber: savedFlow.wabaNumber,
      recipientNumber,
      bodyText,
      ctaText,
      mode: isPublished ? "published" : "draft",
      screenId: screenId || null,
    });

    return res.status(200).json({
      success: true,
      message: "Flow message sent successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

async function updateFlow(req, res, next) {
  const metaFlowId = String(req.params.flowId);
  let jsonUpdatedOnMeta = false;

  try {
    const savedFlow = await findSavedFlow(metaFlowId);
    if (savedFlow.status !== "DRAFT") {
      const error = new Error(
        `Only DRAFT flows can be edited. This Flow is ${savedFlow.status}.`,
      );
      error.code = "FLOW_NOT_EDITABLE";
      error.statusCode = 409;
      throw error;
    }

    const { name, categories, flowJson } = req.validatedBody;
    let validationResult = {
      valid: savedFlow.valid,
      validationErrors: savedFlow.validationErrors || [],
    };

    // Upload JSON first. If it is rejected, metadata remains untouched.
    if (flowJson !== undefined) {
      validationResult = await updateMetaFlowJson({
        flowId: metaFlowId,
        wabaNumber: savedFlow.wabaNumber,
        flowJson,
      });
      jsonUpdatedOnMeta = true;
    }

    if (name !== undefined || categories !== undefined) {
      await updateMetaFlowMetadata({
        flowId: metaFlowId,
        wabaNumber: savedFlow.wabaNumber,
        name,
        categories,
      });
    }

    if (name !== undefined) savedFlow.name = name;
    if (categories !== undefined) savedFlow.categories = categories;
    if (flowJson !== undefined) {
      savedFlow.flowJson = flowJson;
      savedFlow.jsonVersion = flowJson.version || savedFlow.jsonVersion;
      savedFlow.valid = validationResult.valid;
      savedFlow.validationErrors = validationResult.validationErrors;
    }
    await savedFlow.save();

    return res.json({
      success: true,
      message: validationResult.valid
        ? "Flow updated successfully."
        : "Flow updated, but its JSON has validation errors.",
      flow: toClientFlow(savedFlow),
    });
  } catch (error) {
    if (jsonUpdatedOnMeta) {
      error.code = "META_PARTIAL_UPDATE";
      error.statusCode = 502;
      error.message = `Flow JSON was updated on Meta, but the remaining update failed: ${error.message}`;
    }
    next(error);
  }
}

module.exports = {
  createFlow,
  deleteFlow,
  exportFlowJson,
  getAllFlows,
  getFlowDetails,
  publishFlow,
  sendFlow,
  updateFlow,
};
