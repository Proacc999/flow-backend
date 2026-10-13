const express = require("express");
const {
  createFlow,
  deleteFlow,
  exportFlowJson,
  getAllFlows,
  getFlowDetails,
  publishFlow,
  sendFlow,
  updateFlow,
} = require("../controllers/flow.controller");
const {
  validateCreateFlow,
  validateSendFlow,
  validateUpdateFlow,
} = require("../validators/flow.validator");

const router = express.Router();

router.post("/createflows", validateCreateFlow, createFlow);
router.get("/getAllFlows", getAllFlows);
router.get("/flows/:flowId", getFlowDetails);
router.patch("/flows/:flowId", validateUpdateFlow, updateFlow);
router.get("/flows/:flowId/export", exportFlowJson);
router.post("/flows/:flowId/publish", publishFlow);
router.post("/flows/:flowId/sendflowtemplate", validateSendFlow, sendFlow);
router.delete("/flows/:flowId", deleteFlow);

module.exports = router;
