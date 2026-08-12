import { z } from "zod";
import { config } from "../../config.js";
import { query } from "../../db/index.js";
import { writeAudit } from "../../lib/audit.js";
import { HttpError, notFound } from "../../lib/errors.js";
import {
  createOpaqueToken,
  decryptToken,
  encryptToken,
  hashToken,
} from "../../lib/security.js";
import { PERMISSIONS, requireMapPermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validation.js";
import { idSchema } from "./shared.js";

export function registerApiKeyRoutes(router) {
  router.get(
    "/:mapId/api-keys",
    requireMapPermission(PERMISSIONS.API_KEYS_MANAGE),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId);
      const result = await query(
        `SELECT id,name,token_prefix,permissions,status,last_used_at,created_at,
                (token_ciphertext IS NOT NULL) AS token_available
           FROM api_keys WHERE map_id=$1 ORDER BY created_at DESC`,
        [mapId],
      );
      res.json({ success: true, data: result.rows });
    },
  );
  router.get(
    "/:mapId/api-keys/:keyId",
    requireMapPermission(PERMISSIONS.API_KEYS_MANAGE),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId),
        keyId = idSchema.parse(req.params.keyId);
      const result = await query(
        `SELECT id,name,token_hash,token_prefix,token_ciphertext,
                permissions,status,last_used_at,created_at
           FROM api_keys WHERE id=$1 AND map_id=$2`,
        [keyId, mapId],
      );
      const key = result.rows[0];
      if (!key) throw notFound("API Key 不存在");

      let token = null;
      if (key.token_ciphertext) {
        if (!config.apiKeyEncryptionKey) {
          throw new HttpError(
            503,
            "服务端尚未配置 API Key 加密密钥",
            "API_KEY_ENCRYPTION_NOT_CONFIGURED",
          );
        }
        try {
          token = decryptToken(
            key.token_ciphertext,
            config.apiKeyEncryptionKey,
          );
        } catch {
          throw new HttpError(
            500,
            "API Key 解密失败，请联系系统管理员",
            "API_KEY_DECRYPTION_FAILED",
          );
        }
        if (hashToken(token) !== key.token_hash) {
          throw new HttpError(
            500,
            "API Key 完整性校验失败，请联系系统管理员",
            "API_KEY_INTEGRITY_FAILED",
          );
        }
      }

      await writeAudit(req, {
        action: "api_key.view",
        resourceType: "api_key",
        resourceId: keyId,
        mapId,
        details: { tokenAvailable: Boolean(token) },
      });
      const { token_hash, token_ciphertext, ...metadata } = key;
      res.json({
        success: true,
        data: { ...metadata, token, token_available: Boolean(token) },
      });
    },
  );
  router.post(
    "/:mapId/api-keys",
    requireMapPermission(PERMISSIONS.API_KEYS_MANAGE),
    validate(
      z.object({
        name: z.string().trim().min(1).max(100),
        permissions: z
          .array(
            z.enum([
              "game.players.write",
              "game.archives.read",
              "game.archives.write",
              "game.logs.write",
              "game.metrics.write",
              "game.points.write",
              "game.leaderboards.read",
              "game.leaderboards.write",
              "game.risk.write",
              "game.messages.read",
              "game.gifts.read",
            ]),
          )
          .min(1),
      }),
    ),
    async (req, res) => {
      if (!config.apiKeyEncryptionKey) {
        throw new HttpError(
          503,
          "服务端尚未配置 API Key 加密密钥",
          "API_KEY_ENCRYPTION_NOT_CONFIGURED",
        );
      }
      const mapId = idSchema.parse(req.params.mapId),
        token = createOpaqueToken("fqmap_");
      const result = await query(
        `INSERT INTO api_keys(map_id,name,token_hash,token_prefix,token_ciphertext,permissions,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         RETURNING id,name,token_prefix,permissions,status,created_at`,
        [
          mapId,
          req.body.name,
          hashToken(token),
          token.slice(0, 12),
          encryptToken(token, config.apiKeyEncryptionKey),
          req.body.permissions,
          req.user.id,
        ],
      );
      await writeAudit(req, {
        action: "api_key.create",
        resourceType: "api_key",
        resourceId: result.rows[0].id,
        mapId,
        details: { name: req.body.name, permissions: req.body.permissions },
      });
      res.status(201).json({
        success: true,
        data: { ...result.rows[0], token, token_available: true },
      });
    },
  );
  router.delete(
    "/:mapId/api-keys/:keyId",
    requireMapPermission(PERMISSIONS.API_KEYS_MANAGE),
    async (req, res) => {
      const mapId = idSchema.parse(req.params.mapId),
        keyId = idSchema.parse(req.params.keyId);
      const result = await query(
        "UPDATE api_keys SET status='disabled' WHERE id=$1 AND map_id=$2 RETURNING id",
        [keyId, mapId],
      );
      if (!result.rows[0]) throw notFound("API Key 不存在");
      await writeAudit(req, {
        action: "api_key.disable",
        resourceType: "api_key",
        resourceId: keyId,
        mapId,
      });
      res.json({ success: true });
    },
  );
}
