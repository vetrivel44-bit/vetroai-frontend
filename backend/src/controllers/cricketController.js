const asyncHandler = require("../middleware/asyncHandler");
const { successResponse, errorResponse } = require("../utils/response");
const cricketService = require("../services/cricketService");

exports.getLiveMatches = asyncHandler(async (req, res) => {
  const matches = await cricketService.getLiveMatches();
  return successResponse(res, "Live cricket matches", { matches, count: matches.length });
});

exports.getMatchDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) return errorResponse(res, "Match ID is required", 400);
  const match = await cricketService.getMatchDetails(id);
  return successResponse(res, "Match details", match);
});

exports.getCommentary = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) return errorResponse(res, "Match ID is required", 400);
  const commentary = await cricketService.getCommentary(id);
  return successResponse(res, "Match commentary", commentary);
});

exports.getPlayerInfo = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) return errorResponse(res, "Player ID is required", 400);
  const player = await cricketService.getPlayerInfo(id);
  return successResponse(res, "Player info", player);
});
