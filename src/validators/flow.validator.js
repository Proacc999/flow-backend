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
  flowJson: z
    .object({
      version: z.string().min(1, "Flow JSON version is required."),
      screens: z.array(z.unknown()).min(1, "At least one screen is required."),
    })
    .passthrough(),
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

module.exports = { validateCreateFlow };
