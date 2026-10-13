const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { Flow } = require("../src/models/flow.model");

const originalFetch = global.fetch;
const originalFlowCreate = Flow.create;
const originalFlowFind = Flow.find;
const originalFlowFindOne = Flow.findOne;
const originalFlowDeleteOne = Flow.deleteOne;
const originalFlowBulkWrite = Flow.bulkWrite;
const originalEnv = {
  META_GRAPH_BASE_URL: process.env.META_GRAPH_BASE_URL,
  META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION,
  META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
  META_WABA_ID: process.env.META_WABA_ID,
  META_WABA_ACCOUNTS_JSON: process.env.META_WABA_ACCOUNTS_JSON,
};

function configureMeta() {
  process.env.META_GRAPH_BASE_URL = "https://graph.example.test";
  process.env.META_GRAPH_API_VERSION = "v26.0";
  process.env.META_ACCESS_TOKEN = "test-token";
  process.env.META_WABA_ACCOUNTS_JSON = JSON.stringify({
    "15550001111": {
      wabaId: "100000000000001",
      phoneNumberId: "100000000000002",
    },
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test.beforeEach(() => {
  Flow.create = async (flow) => ({
    _id: "507f1f77bcf86cd799439011",
    ...flow,
    createdAt: new Date("2026-10-08T10:00:00.000Z"),
    updatedAt: new Date("2026-10-08T10:00:00.000Z"),
  });
  Flow.bulkWrite = async () => ({ acknowledged: true });
});

test.afterEach(() => {
  global.fetch = originalFetch;
  Flow.create = originalFlowCreate;
  Flow.find = originalFlowFind;
  Flow.findOne = originalFlowFindOne;
  Flow.deleteOne = originalFlowDeleteOne;
  Flow.bulkWrite = originalFlowBulkWrite;
  Object.entries(originalEnv).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

test("allows the Vite development origin during CORS preflight", async () => {
  const response = await request(createApp())
    .options("/api/whatsapp/createflows")
    .set("Origin", "http://localhost:5173")
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "content-type");

  assert.equal(response.status, 204);
  assert.equal(
    response.headers["access-control-allow-origin"],
    "http://localhost:5173",
  );
  assert.match(response.headers["access-control-allow-methods"], /POST/);
});

test("creates a draft with inline flow_json in one Meta request", async () => {
  configureMeta();
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      id: "987654321",
      success: true,
      validation_errors: [],
    });
  };

  const response = await request(createApp())
    .post("/api/whatsapp/createflows")
    .send({
      name: "Test flow",
      categories: ["OTHER"],
      wabaNumber: "15550001111",
      flowJson: {
        version: "7.1",
        screens: [{ id: "WELCOME", layout: { type: "SingleColumnLayout", children: [] } }],
      },
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.flow.id, "987654321");
  assert.equal(response.body.flow.flowId, "987654321");
  assert.equal(response.body.flow.flowName, "Test flow");
  assert.equal(response.body.flow.status, "DRAFT");
  assert.equal(response.body.flow.valid, true);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://graph.example.test/v26.0/100000000000001/flows",
  );
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");

  const metaPayload = JSON.parse(calls[0].options.body);
  assert.equal(metaPayload.name, "Test flow");
  assert.deepEqual(metaPayload.categories, ["OTHER"]);
  assert.equal(metaPayload.publish, false);
  assert.equal(typeof metaPayload.flow_json, "string");
  assert.equal(JSON.parse(metaPayload.flow_json).version, "7.1");
});

test("returns Meta validation errors while retaining the created Flow ID", async () => {
  configureMeta();
  global.fetch = async () => {
    return jsonResponse({
      id: "meta-flow-with-errors",
      success: true,
      validation_errors: [
        {
          error: "INVALID_PROPERTY_VALUE",
          message: "Invalid component type.",
          path: "screens[0].layout.children[0].type",
        },
      ],
    });
  };

  const response = await request(createApp())
    .post("/api/whatsapp/createflows")
    .send({
      name: "Invalid test flow",
      categories: ["SURVEY"],
      wabaNumber: "15550001111",
      flowJson: { version: "7.1", screens: [{ id: "SCREEN_ONE" }] },
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.flow.id, "meta-flow-with-errors");
  assert.equal(response.body.flow.valid, false);
  assert.equal(response.body.flow.validationErrors.length, 1);
});

test("rejects an unmapped mobile number before calling Meta", async () => {
  configureMeta();
  delete process.env.META_WABA_ID;
  let metaWasCalled = false;
  global.fetch = async () => {
    metaWasCalled = true;
    return jsonResponse({});
  };

  const response = await request(createApp())
    .post("/api/whatsapp/createflows")
    .send({
      name: "Unknown WABA",
      categories: ["OTHER"],
      wabaNumber: "910000000000",
      flowJson: { version: "7.1", screens: [{ id: "SCREEN_ONE" }] },
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "WABA_NOT_CONFIGURED");
  assert.equal(metaWasCalled, false);
});

test("returns locally saved flows in newest-first order", async () => {
  configureMeta();
  global.fetch = async (url) => {
    assert.match(url, /\/100000000000001\/flows\?/);
    return jsonResponse({
      data: [
        {
          id: "flow-2",
          name: "Second flow",
          categories: ["SURVEY"],
          status: "DRAFT",
          validation_errors: [],
          json_version: "7.1",
        },
      ],
    });
  };

  Flow.find = () => ({
    sort: () => ({
      lean: async () => [
        {
          _id: "507f1f77bcf86cd799439012",
          metaFlowId: "flow-2",
          name: "Second flow",
          categories: ["SURVEY"],
          wabaId: "100000000000001",
          wabaNumber: "15550001111",
          status: "DRAFT",
          valid: true,
          validationErrors: [],
          flowJson: { version: "7.1", screens: [{ id: "WELCOME" }] },
          createdAt: new Date("2026-10-08T11:00:00.000Z"),
          updatedAt: new Date("2026-10-08T11:00:00.000Z"),
        },
      ],
    }),
  });

  const response = await request(createApp()).get(
    "/api/whatsapp/getAllFlows",
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.source, "meta-synced-to-db");
  assert.equal("warnings" in response.body, false);
  assert.equal(response.body.count, 1);
  assert.equal(response.body.data[0].flowId, "flow-2");
  assert.equal(response.body.data[0].flowName, "Second flow");
  assert.equal(response.body.data[0].screensId, "WELCOME");
});

test("returns a locally saved Flow JSON for preview", async () => {
  const flowJson = {
    version: "7.1",
    screens: [{ id: "LOCAL_PREVIEW", layout: { children: [] } }],
  };
  Flow.findOne = async ({ metaFlowId }) => ({
    _id: "507f1f77bcf86cd799439013",
    metaFlowId,
    name: "Local preview",
    categories: ["OTHER"],
    wabaId: "100000000000001",
    wabaNumber: "15550001111",
    status: "DRAFT",
    valid: true,
    validationErrors: [],
    flowJson,
    createdAt: new Date("2026-10-08T12:00:00.000Z"),
    updatedAt: new Date("2026-10-08T12:00:00.000Z"),
  });
  global.fetch = async () => {
    throw new Error("Meta should not be called when MongoDB has flowJson.");
  };

  const response = await request(createApp()).get(
    "/api/whatsapp/flows/local-flow-id",
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.source, "mongodb");
  assert.deepEqual(response.body.data.flowJson, flowJson);
});

test("downloads missing Flow JSON from Meta and caches it in MongoDB", async () => {
  configureMeta();
  const flowJson = {
    version: "7.1",
    screens: [{ id: "META_PREVIEW", layout: { children: [] } }],
  };
  let saveCount = 0;
  const savedFlow = {
    _id: "507f1f77bcf86cd799439014",
    metaFlowId: "meta-only-flow",
    name: "Meta preview",
    categories: ["SURVEY"],
    wabaId: "100000000000001",
    wabaNumber: "15550001111",
    status: "DRAFT",
    valid: true,
    validationErrors: [],
    flowJson: null,
    jsonVersion: null,
    createdAt: new Date("2026-10-08T13:00:00.000Z"),
    updatedAt: new Date("2026-10-08T13:00:00.000Z"),
    save: async () => {
      saveCount += 1;
    },
  };
  Flow.findOne = async () => savedFlow;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/meta-only-flow/assets")) {
      return jsonResponse({
        data: [
          {
            name: "flow.json",
            asset_type: "FLOW_JSON",
            download_url: "https://assets.example.test/flow.json",
          },
        ],
      });
    }
    if (url === "https://assets.example.test/flow.json") {
      return jsonResponse(flowJson);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const response = await request(createApp()).get(
    "/api/whatsapp/flows/meta-only-flow",
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.source, "meta-cached-to-mongodb");
  assert.deepEqual(response.body.data.flowJson, flowJson);
  assert.deepEqual(savedFlow.flowJson, flowJson);
  assert.equal(savedFlow.jsonVersion, "7.1");
  assert.equal(saveCount, 1);
  assert.equal(calls.length, 2);
});

test("publishes a Flow on Meta and updates its MongoDB status", async () => {
  configureMeta();
  let saveCount = 0;
  const savedFlow = {
    _id: "507f1f77bcf86cd799439015",
    metaFlowId: "draft-to-publish",
    name: "Publish me",
    categories: ["OTHER"],
    wabaId: "100000000000001",
    wabaNumber: "15550001111",
    status: "DRAFT",
    valid: true,
    validationErrors: [],
    flowJson: { version: "7.1", screens: [] },
    createdAt: new Date("2026-10-09T08:00:00.000Z"),
    updatedAt: new Date("2026-10-09T08:00:00.000Z"),
    save: async () => {
      saveCount += 1;
    },
  };
  Flow.findOne = async () => savedFlow;
  global.fetch = async (url, options) => {
    assert.equal(
      url,
      "https://graph.example.test/v26.0/draft-to-publish/publish",
    );
    assert.equal(options.method, "POST");
    return jsonResponse({ success: true });
  };

  const response = await request(createApp()).post(
    "/api/whatsapp/flows/draft-to-publish/publish",
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.flow.status, "PUBLISHED");
  assert.equal(savedFlow.status, "PUBLISHED");
  assert.equal(saveCount, 1);
});

test("deletes a draft Flow from Meta and MongoDB", async () => {
  configureMeta();
  const savedFlow = {
    metaFlowId: "draft-to-delete",
    wabaNumber: "15550001111",
    status: "DRAFT",
  };
  let deletedFilter = null;
  Flow.findOne = async () => savedFlow;
  Flow.deleteOne = async (filter) => {
    deletedFilter = filter;
    return { acknowledged: true, deletedCount: 1 };
  };
  global.fetch = async (url, options) => {
    assert.equal(
      url,
      "https://graph.example.test/v26.0/draft-to-delete",
    );
    assert.equal(options.method, "DELETE");
    return jsonResponse({ success: true });
  };

  const response = await request(createApp()).delete(
    "/api/whatsapp/flows/draft-to-delete",
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.flowId, "draft-to-delete");
  assert.deepEqual(deletedFilter, { metaFlowId: "draft-to-delete" });
});

test("does not delete a published Flow", async () => {
  configureMeta();
  let metaWasCalled = false;
  Flow.findOne = async () => ({
    metaFlowId: "published-flow",
    wabaNumber: "15550001111",
    status: "PUBLISHED",
  });
  global.fetch = async () => {
    metaWasCalled = true;
    return jsonResponse({ success: true });
  };

  const response = await request(createApp()).delete(
    "/api/whatsapp/flows/published-flow",
  );

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "FLOW_NOT_DELETABLE");
  assert.equal(metaWasCalled, false);
});

test("exports the saved Flow JSON as a flow-name.json attachment", async () => {
  const flowJson = {
    screens: [
      {
        layout: {
          children: [{ text: "Hello", type: "TextSubheading" }],
          type: "SingleColumnLayout",
        },
        id: "WELCOME",
        terminal: true,
        title: "Welcome",
      },
    ],
    version: "7.1",
  };
  Flow.findOne = async () => ({
    metaFlowId: "export-flow",
    name: "Customer: Survey",
    wabaNumber: "15550001111",
    flowJson,
  });

  const response = await request(createApp()).get(
    "/api/whatsapp/flows/export-flow/export",
  );

  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /application\/json/);
  assert.match(
    response.headers["content-disposition"],
    /^attachment; filename="Customer_ Survey\.json";/,
  );
  assert.deepEqual(response.body, flowJson);
});

test("sends a published Flow with a recognizable random flow token", async () => {
  configureMeta();
  Flow.findOne = async () => ({
    metaFlowId: "1254619368752741",
    name: "testdocall2",
    wabaNumber: "15550001111",
    status: "PUBLISHED",
  });
  let sentPayload;
  global.fetch = async (url, options) => {
    assert.equal(
      url,
      "https://graph.example.test/v26.0/100000000000002/messages",
    );
    assert.equal(options.method, "POST");
    sentPayload = JSON.parse(options.body);
    return jsonResponse({
      messaging_product: "whatsapp",
      contacts: [{ input: "919874563210", wa_id: "919874563210" }],
      messages: [{ id: "wamid.test-message" }],
    });
  };

  const response = await request(createApp())
    .post("/api/whatsapp/flows/1254619368752741/sendflowtemplate")
    .send({
      recipientNumber: "+91 98745 63210",
      bodyText: "this is test to send flow",
      ctaText: "start survey",
      screenId: null,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.messageId, "wamid.test-message");
  assert.match(response.body.data.flowToken, /^testdocall2_[a-f0-9]{16}$/);
  assert.equal(sentPayload.messaging_product, "whatsapp");
  assert.equal(sentPayload.recipient_type, "individual");
  assert.equal(sentPayload.to, "919874563210");
  assert.equal(sentPayload.type, "interactive");
  assert.equal(sentPayload.interactive.type, "flow");
  assert.equal(
    sentPayload.interactive.body.text,
    "this is test to send flow",
  );
  assert.deepEqual(sentPayload.interactive.action.parameters, {
    flow_message_version: "3",
    flow_token: response.body.data.flowToken,
    flow_id: "1254619368752741",
    flow_cta: "start survey",
    mode: "published",
    flow_action: "navigate",
  });
});

test("requires message body and CTA text for a published Flow", async () => {
  configureMeta();
  let metaWasCalled = false;
  Flow.findOne = async () => ({
    metaFlowId: "published-send-validation",
    name: "Published Flow",
    wabaNumber: "15550001111",
    status: "PUBLISHED",
  });
  global.fetch = async () => {
    metaWasCalled = true;
    return jsonResponse({});
  };

  const response = await request(createApp())
    .post(
      "/api/whatsapp/flows/published-send-validation/sendflowtemplate",
    )
    .send({ recipientNumber: "919874563210" });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "SEND_FIELDS_REQUIRED");
  assert.equal(metaWasCalled, false);
});

function makeEditableFlow(overrides = {}) {
  return {
    _id: "507f1f77bcf86cd799439099",
    metaFlowId: "editable-flow",
    name: "Original name",
    categories: ["OTHER"],
    wabaId: "100000000000001",
    wabaNumber: "15550001111",
    status: "DRAFT",
    valid: true,
    validationErrors: [],
    flowJson: { version: "7.1", screens: [{ id: "OLD" }] },
    jsonVersion: "7.1",
    createdAt: new Date("2026-10-12T08:00:00.000Z"),
    updatedAt: new Date("2026-10-12T08:00:00.000Z"),
    save: async () => {},
    ...overrides,
  };
}

test("edits only Flow metadata through the single edit API", async () => {
  configureMeta();
  const savedFlow = makeEditableFlow();
  Flow.findOne = async () => savedFlow;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ success: true });
  };

  const response = await request(createApp())
    .patch("/api/whatsapp/flows/editable-flow")
    .send({ name: "Renamed Flow", categories: ["SURVEY"] });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://graph.example.test/v26.0/editable-flow",
  );
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    name: "Renamed Flow",
    categories: ["SURVEY"],
  });
  assert.equal(savedFlow.name, "Renamed Flow");
  assert.deepEqual(savedFlow.categories, ["SURVEY"]);
  assert.equal(savedFlow.flowJson.screens[0].id, "OLD");
});

test("edits only Flow JSON using Meta multipart upload", async () => {
  configureMeta();
  const savedFlow = makeEditableFlow();
  const nextFlowJson = {
    version: "7.1",
    screens: [{ id: "UPDATED", layout: { children: [] } }],
  };
  Flow.findOne = async () => savedFlow;
  let uploadedForm;
  global.fetch = async (url, options) => {
    assert.equal(
      url,
      "https://graph.example.test/v26.0/editable-flow/assets",
    );
    assert.equal(options.method, "POST");
    uploadedForm = options.body;
    return jsonResponse({ success: true, validation_errors: [] });
  };

  const response = await request(createApp())
    .patch("/api/whatsapp/flows/editable-flow")
    .send({ flowJson: nextFlowJson });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.ok(uploadedForm instanceof FormData);
  assert.equal(uploadedForm.get("name"), "flow.json");
  assert.equal(uploadedForm.get("asset_type"), "FLOW_JSON");
  assert.deepEqual(
    JSON.parse(await uploadedForm.get("file").text()),
    nextFlowJson,
  );
  assert.deepEqual(savedFlow.flowJson, nextFlowJson);
  assert.equal(savedFlow.name, "Original name");
});

test("edits Flow JSON and metadata together through one edit API request", async () => {
  configureMeta();
  const savedFlow = makeEditableFlow();
  const nextFlowJson = {
    version: "7.2",
    screens: [{ id: "BOTH_UPDATED", layout: { children: [] } }],
  };
  Flow.findOne = async () => savedFlow;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse(
      url.endsWith("/assets")
        ? { success: true, validation_errors: [] }
        : { success: true },
    );
  };

  const response = await request(createApp())
    .patch("/api/whatsapp/flows/editable-flow")
    .send({
      name: "Everything Updated",
      categories: ["LEAD_GENERATION"],
      flowJson: nextFlowJson,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/editable-flow\/assets$/);
  assert.match(calls[1].url, /\/editable-flow$/);
  assert.equal(savedFlow.name, "Everything Updated");
  assert.deepEqual(savedFlow.categories, ["LEAD_GENERATION"]);
  assert.deepEqual(savedFlow.flowJson, nextFlowJson);
  assert.equal(savedFlow.jsonVersion, "7.2");
});

test("rejects edits to a published Flow before calling Meta", async () => {
  configureMeta();
  let metaWasCalled = false;
  Flow.findOne = async () => makeEditableFlow({ status: "PUBLISHED" });
  global.fetch = async () => {
    metaWasCalled = true;
    return jsonResponse({ success: true });
  };

  const response = await request(createApp())
    .patch("/api/whatsapp/flows/editable-flow")
    .send({ name: "Should fail" });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "FLOW_NOT_EDITABLE");
  assert.equal(metaWasCalled, false);
});
