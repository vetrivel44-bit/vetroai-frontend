const { Router } = require("express");
const cricket = require("../controllers/cricketController");

const router = Router();

router.get("/live", cricket.getLiveMatches);
router.get("/match/:id", cricket.getMatchDetails);
router.get("/commentary/:id", cricket.getCommentary);
router.get("/player/:id", cricket.getPlayerInfo);

module.exports = router;
