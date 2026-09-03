import { Router } from "express";
import {
  registerMapLifecycleRoutes,
  registerRuntimeRoutes,
} from "./maps/map-lifecycle.js";
import { registerMessageRoutes, registerPlayerRoutes } from "./maps/players.js";
import { registerLeaderboardRoutes } from "./maps/leaderboards.js";
import { registerRiskRoutes } from "./maps/risk.js";
import { registerGiftRoutes, registerLotteryRoutes } from "./maps/gifts.js";
import { registerFeedbackRoutes } from "./maps/feedback.js";
import { registerResourceRoutes } from "./maps/resources.js";
import { registerFileRoutes } from "./maps/files.js";
import { registerApiKeyRoutes } from "./maps/api-keys.js";

const router = Router();

registerMapLifecycleRoutes(router);
registerPlayerRoutes(router);
registerLeaderboardRoutes(router);
registerRiskRoutes(router);
registerGiftRoutes(router);
registerMessageRoutes(router);
registerLotteryRoutes(router);
registerFeedbackRoutes(router);
registerRuntimeRoutes(router);
registerResourceRoutes(router);
registerFileRoutes(router);
registerApiKeyRoutes(router);

export default router;
