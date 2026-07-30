const express = require("express");

const aiController = require("../../../controllers/aiController");
const integrationController = require("../../../controllers/integrationController");
const deviceController = require("../../../controllers/deviceController");
const telemetryController = require("../../../controllers/telemetryController");
const pluginController = require("../../../controllers/pluginController");
const memoryController = require("../../../controllers/memoryController");

const router = express.Router();

// ---- Dashboard & telemetri ------------------------------------

router.get("/overview", telemetryController.overview);
router.get("/stats", telemetryController.stats);
router.get("/logs", telemetryController.logs);
router.get("/events", telemetryController.events);

// ---- AI runtime ------------------------------------------------

router.get("/ai/providers", aiController.providers);
router.post("/ai/provider", aiController.selectProvider);
router.get("/ai/models", aiController.models);
router.post("/ai/model", aiController.selectModel);
router.get("/ai/metrics", aiController.metrics);
router.post("/ai/chat", aiController.chat);
router.post("/ai/stream", aiController.stream);

// ---- Plugin & tool ---------------------------------------------

router.get("/plugins", pluginController.list);
router.get("/tools", pluginController.tools);
router.post("/tools/:id/execute", pluginController.execute);

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

// ---- Perangkat (mic / kamera / sensor) -------------------------

router.get("/devices", deviceController.get);
router.put("/devices", deviceController.update);
router.post("/devices/sensors", deviceController.addSensor);
router.delete("/devices/sensors/:id", deviceController.removeSensor);
router.get("/devices/sensors/readings", deviceController.readSensors);

module.exports = router;
