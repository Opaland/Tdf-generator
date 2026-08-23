'use strict';
// Notification d'échec de génération (backlog issue #10, section E) — webhook
// simple, désactivé par défaut (ETAPEFORGE_NOTIFY_WEBHOOK_URL non défini =
// aucun changement de comportement). Pas d'intégration propriétaire figée
// (Telegram, Discord…) : un POST générique qui vise le plus grand nombre de
// récepteurs simples sans configuration supplémentaire —
//   - JSON (par défaut) : {text, content, ...} — `text` est lu par les
//     webhooks entrants Slack, `content` par ceux de Discord ; les deux
//     champs portent le même message, chaque service ignore celui qu'il ne
//     connaît pas ;
//   - texte brut (ETAPEFORGE_NOTIFY_FORMAT=text) : le message seul, format
//     attendu par ntfy.sh (auto-hébergeable, sans compte — cohérent avec la
//     philosophie 100 % locale du projet) et la plupart des webhooks
//     génériques (Home Assistant, n8n…).
// Un vrai bot Telegram (API chat_id/token) ou un service qui exige un corps
// différent nécessite un petit relais côté utilisateur — hors scope ici.

const WEBHOOK_URL = process.env.ETAPEFORGE_NOTIFY_WEBHOOK_URL || null;
const FORMAT = process.env.ETAPEFORGE_NOTIFY_FORMAT === 'text' ? 'text' : 'json';

function buildMessage({ stageId, stageName, error }) {
  return `ÉtapeForge — échec de génération : « ${stageName} » (étape #${stageId}) — ${error}`;
}

/**
 * Envoie une notification d'échec de génération. Renvoie true si le webhook a
 * répondu 2xx, false s'il n'est pas configuré ou a échoué (jamais d'exception
 * — une notification ratée ne doit jamais faire planter la génération).
 */
async function notifyGenerationFailure(info, webhookUrl = WEBHOOK_URL, format = FORMAT) {
  if (!webhookUrl) return false;
  const message = buildMessage(info);
  const isText = format === 'text';
  const body = isText
    ? message
    : JSON.stringify({
        text: message,
        content: message,
        stage_id: info.stageId,
        stage_name: info.stageName,
        error: info.error,
        timestamp: new Date().toISOString(),
      });
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json' },
      body,
    });
    if (!res.ok) console.error(`Notification webhook échouée : HTTP ${res.status} (${webhookUrl})`);
    return res.ok;
  } catch (err) {
    console.error('Notification webhook injoignable :', err.message);
    return false;
  }
}

module.exports = { notifyGenerationFailure, buildMessage, WEBHOOK_URL, FORMAT };
