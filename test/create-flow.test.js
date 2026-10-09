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
    "919251006460": "1368265205374974",
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
      wabaNumber: "919251006460",
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
    "https://graph.example.test/v26.0/1368265205374974/flows",
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
      wabaNumber: "919251006460",
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
    assert.match(url, /\/1368265205374974\/flows\?/);
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
          wabaId: "1368265205374974",
          wabaNumber: "919251006460",
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
    wabaId: "1368265205374974",
    wabaNumber: "919251006460",
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
    wabaId: "1368265205374974",
    wabaNumber: "919251006460",
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
    wabaId: "1368265205374974",
    wabaNumber: "919251006460",
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
    wabaNumber: "919251006460",
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
    wabaNumber: "919251006460",
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
    wabaNumber: "919251006460",
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
