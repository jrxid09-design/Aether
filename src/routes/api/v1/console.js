const express = require("express");

const aiController = require("../../../controllers/aiController");
const integrationController = require("../../../controllers/integrationController");
const deviceController = require("../../../controllers/deviceController");
const telemetryController = require("../../../controllers/telemetryController");
const pluginController = require("../../../controllers/pluginController");
const memoryController = require("../../../controllers/memoryController");
const voiceController = require("../../../controllers/voiceController");
const forgeController = require("../../../controllers/forgeController");
const whatsappController = require("../../../controllers/whatsappController");
const orchestratorController = require("../../../controllers/orchestratorController");
const homeController = require("../../../controllers/homeController");
const visionController = require("../../../controllers/visionController");
const peopleController = require("../../../controllers/peopleController");
const contextController = require("../../../controllers/contextController");
const automationController = require("../../../controllers/automationController");
const roleController = require("../../../controllers/roleController");
const terminalController = require("../../../controllers/terminalController");
const runtimeController = require("../../../controllers/runtimeController");

const router = express.Router();

// ---- Dashboard & telemetri ------------------------------------

router.get("/overview", telemetryController.overview);
router.get("/context", contextController.snapshot);
router.post("/context/brief", contextController.brief);
router.get("/stats", telemetryController.stats);
router.get("/logs", telemetryController.logs);
router.get("/events", telemetryController.events);

// ---- AI runtime ------------------------------------------------

router.get("/ai/config", aiController.config);
router.post("/ai/config", aiController.saveConfig);
router.get("/ai/providers", aiController.providers);
router.post("/ai/provider", aiController.selectProvider);
router.get("/ai/models", aiController.models);
router.post("/ai/models/verify", aiController.verifyModels);
router.post("/ai/model", aiController.selectModel);
router.get("/ai/metrics", aiController.metrics);
router.post("/ai/chat", aiController.chat);
router.post("/ai/stream", aiController.stream);

// ---- Plugin & tool ---------------------------------------------

router.get("/plugins", pluginController.list);
router.get("/tools", pluginController.tools);
router.post("/tools/:id/execute", pluginController.execute);

// ---- Forge (Aether bikin tool sendiri / editor manual) ---------

router.get("/forge", forgeController.list);
router.post("/forge", forgeController.create);
router.get("/forge/:id", forgeController.read);
router.post("/forge/:id/approve", forgeController.approve);
router.post("/forge/:id/reject", forgeController.reject);
router.delete("/forge/:id", forgeController.remove);

// ---- Home automation -------------------------------------------

router.get("/home/status", homeController.status);
router.get("/home/config", homeController.config);
router.post("/home/config", homeController.saveConfig);
router.get("/home/devices", homeController.devices);
router.post("/home/control", homeController.control);

// ---- Vision ----------------------------------------------------

router.get("/vision/status", visionController.status);
router.get("/vision/config", visionController.config);
router.post("/vision/config", visionController.saveConfig);
router.post("/vision/analyze", visionController.analyze);
router.get("/cameras", visionController.cameras);
router.post("/cameras", visionController.addCamera);
router.delete("/cameras/:id", visionController.removeCamera);
router.get("/cameras/:id/snapshot", visionController.snapshot);
router.post("/cameras/:id/see", visionController.seeCamera);

// ---- Orang & wajah (Immich + face-match) -----------------------

router.get("/people/status", peopleController.status);
router.post("/people/immich", peopleController.saveImmich);
router.post("/people/face", peopleController.saveFace);
router.get("/people", peopleController.people);
router.post("/people/search", peopleController.search);

// ---- Multi-agent orkestrasi ------------------------------------

router.get("/agents", orchestratorController.agents);
router.post("/orchestrate", orchestratorController.orchestrate);

// ---- WhatsApp --------------------------------------------------

// ---- Runtime API (status runtime inti utk Runtime Console) -----

router.get("/runtime/status", runtimeController.status);
router.post("/runtime/:key/restart", runtimeController.restart);

// ---- Terminal Runtime (sesi pty persisten) ---------------------

router.get("/terminals", terminalController.list);
router.post("/terminals", terminalController.create);
router.get("/terminals/:id/output", terminalController.read);
router.post("/terminals/:id/input", terminalController.input);
router.post("/terminals/:id/signal", terminalController.signal);
router.post("/terminals/:id/resize", terminalController.resize);
router.post("/terminals/:id/execute", terminalController.execute);
router.patch("/terminals/:id", terminalController.rename);
router.delete("/terminals/:id", terminalController.remove);

// ---- Peran pengguna (SuperAdmin/Admin/User) --------------------

router.get("/roles", roleController.status);
router.post("/roles", roleController.saveConfig);

// ---- Proaktif (brief terjadwal) --------------------------------

router.get("/automation/status", automationController.status);
router.post("/automation/config", automationController.saveConfig);
router.post("/automation/run", automationController.run);

// ---- WhatsApp --------------------------------------------------

router.get("/whatsapp/status", whatsappController.status);
router.get("/whatsapp/groups", whatsappController.groups);
router.post("/whatsapp/config", whatsappController.saveConfig);
router.post("/whatsapp/connect", whatsappController.connect);
router.post("/whatsapp/logout", whatsappController.logout);
router.post("/whatsapp/test", whatsappController.test);

// ---- Integrasi eksternal ---------------------------------------

router.get("/integrations", integrationController.list);
router.post("/integrations/check", integrationController.checkAll);
router.post("/integrations/:id/check", integrationController.check);
router.patch("/integrations/:id", integrationController.update);
router.get("/integrations/:id/models", integrationController.models);

// ---- Memori jangka panjang -------------------------------------

router.get("/memory/stats", memoryController.stats);
router.get("/memory", memoryController.list);
router.post("/memory", memoryController.remember);
router.post("/memory/recall", memoryController.recall);
router.post("/memory/consolidate", memoryController.consolidate);
router.get("/memory/embeddings", memoryController.embeddingStatus);
router.post("/memory/embeddings/backfill", memoryController.backfill);

router.get("/memory/entities", memoryController.entities);
router.post("/memory/entities", memoryController.createEntity);
router.get("/memory/entities/:id", memoryController.entity);
router.patch("/memory/entities/:id", memoryController.updateEntity);
router.delete("/memory/entities/:id", memoryController.removeEntity);

router.get("/memory/documents", memoryController.documents);
router.post("/memory/documents", memoryController.ingest);
router.get("/memory/documents/:id/chunks", memoryController.documentChunks);
router.delete("/memory/documents/:id", memoryController.removeDocument);

// Rute ber-parameter ditaruh paling akhir agar tidak menelan
// "/memory/entities" dan kawan-kawan.
router.get("/memory/:id", memoryController.get);
router.patch("/memory/:id", memoryController.update);
router.delete("/memory/:id", memoryController.forget);

// ---- Suara (STT) -----------------------------------------------

router.get("/voice/status", voiceController.status);
router.get("/voice/config", voiceController.config);
router.post("/voice/config", voiceController.saveConfig);
router.post("/voice/transcribe", voiceController.transcribe);
router.post("/voice/speak", voiceController.speak);

// ---- Perangkat (mic / kamera / sensor) -------------------------

router.get("/devices", deviceController.get);
router.put("/devices", deviceController.update);
router.post("/devices/sensors", deviceController.addSensor);
router.delete("/devices/sensors/:id", deviceController.removeSensor);
router.get("/devices/sensors/readings", deviceController.readSensors);

module.exports = router;
