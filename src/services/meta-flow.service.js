const {
  getConfig,
  resolveMetaAccount,
  getMetaAccounts,
} = require("../config/env");

class MetaApiError extends Error {
  constructor(message, { statusCode = 502, metaError, metaFlowId } = {}) {
    super(message);
    this.name = "MetaApiError";
    this.code = "META_API_ERROR";
    this.statusCode = statusCode;
    this.metaError = metaError;
    this.metaFlowId = metaFlowId;
  }
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function callMeta(url, options, metaFlowId) {
  const { metaRequestTimeoutMs } = getConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), metaRequestTimeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const body = await readResponseBody(response);

    if (!response.ok || body.error) {
      const metaError = body.error || body;
      throw new MetaApiError(
        metaError?.error_user_msg ||
          metaError?.message ||
          `Meta returned HTTP ${response.status}.`,
        { metaError, metaFlowId },
      );
    }

    return body;
  } catch (error) {
    if (error instanceof MetaApiError) throw error;

    const message =
      error.name === "AbortError"
        ? "The request to Meta timed out."
        : `Could not reach Meta: ${error.message}`;
    throw new MetaApiError(message, { metaFlowId });
  } finally {
    clearTimeout(timeout);
  }
}

async function createMetaFlow({ name, categories, wabaNumber, flowJson }) {
  const serializedFlow = JSON.stringify(flowJson);
  if (Buffer.byteLength(serializedFlow, "utf8") > 10 * 1024 * 1024) {
    throw new MetaApiError("The generated flow.json exceeds Meta's 10 MB limit.", {
      statusCode: 400,
    });
  }

  const body = JSON.stringify({
    name,
    categories,
    flow_json: serializedFlow,
    // Phase 1 must always create an editable draft. Publishing remains a
    // separate, explicit operation because it cannot be reversed.
    publish: false,
  });

  console.log("final body data", body);

  const { graphBaseUrl, graphApiVersion } = getConfig();
  const { wabaId, accessToken } = resolveMetaAccount(wabaNumber);

  const createResponse = await callMeta(
    `${graphBaseUrl}/${graphApiVersion}/${encodeURIComponent(wabaId)}/flows`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body,
    },
  );

  const metaFlowId = createResponse.id;
  if (!metaFlowId) {
    throw new MetaApiError("Meta did not return a Flow ID.", {
      metaError: createResponse,
    });
  }

  const validationErrors = createResponse.validation_errors || [];

  return {
    id: String(metaFlowId),
    wabaId,
    wabaNumber: String(wabaNumber),
    name,
    categories,
    status: "DRAFT",
    valid: validationErrors.length === 0,
    validationErrors,
  };
}

async function getMetaFlowJson({ flowId, wabaNumber }) {
  const { graphBaseUrl, graphApiVersion } = getConfig();
  const { accessToken } = resolveMetaAccount(wabaNumber);
  const headers = { Authorization: `Bearer ${accessToken}` };

  const assetsResponse = await callMeta(
    `${graphBaseUrl}/${graphApiVersion}/${encodeURIComponent(flowId)}/assets`,
    { method: "GET", headers },
    String(flowId),
  );
  const flowJsonAsset = (assetsResponse.data || []).find(
    (asset) => asset.asset_type === "FLOW_JSON" && asset.download_url,
  );

  if (!flowJsonAsset) {
    throw new MetaApiError("Meta did not return a FLOW_JSON asset for this Flow.", {
      statusCode: 404,
      metaFlowId: String(flowId),
    });
  }

  const flowJson = await callMeta(
    flowJsonAsset.download_url,
    { method: "GET", headers },
    String(flowId),
  );

  if (!flowJson || typeof flowJson !== "object" || Array.isArray(flowJson)) {
    throw new MetaApiError("Meta returned an invalid Flow JSON asset.", {
      metaFlowId: String(flowId),
    });
  }

  return flowJson;
}

async function publishMetaFlow({ flowId, wabaNumber }) {
  const { graphBaseUrl, graphApiVersion } = getConfig();
  const { accessToken } = resolveMetaAccount(wabaNumber);

  const response = await callMeta(
    `${graphBaseUrl}/${graphApiVersion}/${encodeURIComponent(flowId)}/publish`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    String(flowId),
  );

  if (response.success !== true) {
    throw new MetaApiError("Meta did not confirm that the Flow was published.", {
      metaError: response,
      metaFlowId: String(flowId),
    });
  }

  return { success: true };
}

async function deleteMetaFlow({ flowId, wabaNumber }) {
  const { graphBaseUrl, graphApiVersion } = getConfig();
  const { accessToken } = resolveMetaAccount(wabaNumber);

  const response = await callMeta(
    `${graphBaseUrl}/${graphApiVersion}/${encodeURIComponent(flowId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    String(flowId),
  );

  if (response.success !== true) {
    throw new MetaApiError("Meta did not confirm that the Flow was deleted.", {
      metaError: response,
      metaFlowId: String(flowId),
    });
  }

  return { success: true };
}

async function listMetaFlows({ wabaNumber } = {}) {
  const { graphBaseUrl, graphApiVersion } = getConfig();
  const accounts = wabaNumber
    ? [
        {
          wabaNumber: String(wabaNumber),
          ...resolveMetaAccount(wabaNumber),
        },
      ]
    : getMetaAccounts();

  const accountResults = await Promise.all(
    accounts.map(async ({ wabaNumber: number, wabaId, accessToken }) => {
      const flows = [];
      let nextUrl =
        `${graphBaseUrl}/${graphApiVersion}/${encodeURIComponent(wabaId)}/flows` +
        "?fields=id,name,status,categories,validation_errors,json_version&limit=100";
      let pageCount = 0;

      while (nextUrl && pageCount < 20) {
        const response = await callMeta(nextUrl, {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        flows.push(
          ...(response.data || []).map((flow) => {
            const validationErrors = flow.validation_errors || [];
            return {
              id: String(flow.id),
              name: flow.name,
              categories: flow.categories || ["OTHER"],
              status: flow.status || "DRAFT",
              validationErrors,
              valid: validationErrors.length === 0,
              jsonVersion: flow.json_version || null,
              wabaId: String(wabaId),
              wabaNumber: String(number),
            };
          }),
        );

        nextUrl = response.paging?.next || null;
        pageCount += 1;
      }

      return { flows, wabaNumber: number, wabaId };
    }),
  );

  return {
    flows: accountResults.flatMap((account) => account.flows),
  };
}

module.exports = {
  createMetaFlow,
  deleteMetaFlow,
  getMetaFlowJson,
  listMetaFlows,
  publishMetaFlow,
  MetaApiError,
};
