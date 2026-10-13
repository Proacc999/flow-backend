const { z } = require("zod");

const FLOW_CATEGORIES = [
  "SIGN_UP",
  "SIGN_IN",
  "APPOINTMENT_BOOKING",
  "LEAD_GENERATION",
  "CONTACT_US",
  "CUSTOMER_SUPPORT",
  "SURVEY",
  "OTHER",
];

const flowJsonSchema = z
  .object({
    version: z.string().min(1, "Flow JSON version is required."),
    screens: z.array(z.unknown()).min(1, "At least one screen is required."),
  })
  .passthrough();

const createFlowSchema = z.object({
  name: z.string().trim().min(1, "Flow name is required.").max(200),
  categories: z
    .array(z.enum(FLOW_CATEGORIES))
    .min(1, "At least one category is required."),
  // The current UI intentionally sends mobileNo. The server resolves it to
  // the corresponding Meta WABA ID without exposing that mapping to React.
  wabaNumber: z
    .union([z.string().trim().min(1, "WABA number is required."), z.number()])
    .transform(String),
  flowJson: flowJsonSchema,
});

const updateFlowSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    categories: z
      .array(z.enum(FLOW_CATEGORIES))
      .min(1, "At least one category is required.")
      .optional(),
    flowJson: flowJsonSchema.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.categories !== undefined ||
      value.flowJson !== undefined,
    { message: "Provide metadata, flowJson, or both." },
  );

const sendFlowSchema = z.object({
  recipientNumber: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).replace(/\D/g, ""))
    .refine((value) => /^\d{8,15}$/.test(value), {
      message: "Recipient number must contain 8 to 15 digits with country code.",
    }),
  bodyText: z.string().trim().max(1024).optional().default(""),
  ctaText: z.string().trim().max(30).optional().default(""),
  screenId: z.string().trim().min(1).nullable().optional(),
});

function validateCreateFlow(req, res, next) {
  const result = createFlowSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_REQUEST",
        message: "The create Flow request is invalid.",
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }

  req.validatedBody = result.data;
  next();
}

function validateSendFlow(req, res, next) {
  const result = sendFlowSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_REQUEST",
        message: "The send Flow request is invalid.",
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }

  req.validatedBody = result.data;
  next();
}

function validateUpdateFlow(req, res, next) {
  const result = updateFlowSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_REQUEST",
        message: "The edit Flow request is invalid.",
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }

  req.validatedBody = result.data;
  next();
}

module.exports = {
  validateCreateFlow,
  validateSendFlow,
  validateUpdateFlow,
};
