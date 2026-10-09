const express = require("express");
const {
  createFlow,
  deleteFlow,
  exportFlowJson,
  getAllFlows,
  getFlowDetails,
  publishFlow,
} = require("../controllers/flow.controller");
const { validateCreateFlow } = require("../validators/flow.validator");

const router = express.Router();

router.post("/createflows", validateCreateFlow, createFlow);
router.get("/getAllFlows", getAllFlows);
router.get("/flows/:flowId", getFlowDetails);
router.get("/flows/:flowId/export", exportFlowJson);
router.post("/flows/:flowId/publish", publishFlow);
router.delete("/flows/:flowId", deleteFlow);

module.exports = router;
