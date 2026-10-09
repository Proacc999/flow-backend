const mongoose = require("mongoose");

const flowSchema = new mongoose.Schema(
  {
    metaFlowId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    categories: {
      type: [String],
      required: true,
      validate: {
        validator: (categories) => categories.length > 0,
        message: "At least one Flow category is required.",
      },
    },
    wabaId: { type: String, required: true, trim: true, index: true },
    wabaNumber: { type: String, required: true, trim: true, index: true },
    status: {
      type: String,
      enum: ["DRAFT", "PUBLISHED", "DEPRECATED", "BLOCKED", "THROTTLED"],
      default: "DRAFT",
      index: true,
    },
    valid: { type: Boolean, default: true },
    validationErrors: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // Flows created through this application have their JSON saved here.
    // Flows discovered by Meta sync may not have their asset downloaded yet.
    flowJson: { type: mongoose.Schema.Types.Mixed, default: null },
    jsonVersion: { type: String, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

flowSchema.index({ createdAt: -1 });

function toClientFlow(flow) {
  const value = flow?.toObject ? flow.toObject() : flow;
  const flowId = String(value.metaFlowId);
  const createdAt = value.createdAt || new Date();

  return {
    id: flowId,
    srNo: String(value._id),
    flowId,
    flowName: value.name,
    name: value.name,
    category: value.categories?.[0] || "OTHER",
    categories: value.categories || [],
    status: value.status,
    channel: "WhatsApp",
    mobileno: value.wabaNumber,
    wabaNumber: value.wabaNumber,
    wabaId: value.wabaId,
    screensId: value.flowJson?.screens?.[0]?.id || null,
    valid: value.valid,
    validationErrors: value.validationErrors || [],
    insertTime: new Date(createdAt).toISOString(),
    createdAt: new Date(createdAt).toISOString(),
    updatedAt: new Date(value.updatedAt || createdAt).toISOString(),
  };
}

const Flow = mongoose.models.Flow || mongoose.model("Flow", flowSchema);

module.exports = { Flow, toClientFlow };
