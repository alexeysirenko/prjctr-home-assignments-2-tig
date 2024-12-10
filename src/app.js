require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const { Client } = require("@elastic/elasticsearch");
const winston = require("winston");

// Logger configuration
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level}]: ${message} ${
        Object.keys(meta).length ? JSON.stringify(meta) : ""
      }`;
    })
  ),
  transports: [new winston.transports.Console()],
});

const app = express();
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI;
const ELASTICSEARCH_HOST = process.env.ELASTICSEARCH_HOST;

const esClient = new Client({ node: ELASTICSEARCH_HOST });

app.use(bodyParser.json());

// Mongoose schema and model
const messageSchema = new mongoose.Schema({
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const Message = mongoose.model("Message", messageSchema);

// Ensure Elasticsearch index exists
const ensureElasticsearchIndex = async () => {
  const indexExists = await esClient.indices.exists({ index: "messages" });
  if (!indexExists.body) {
    await esClient.indices.create({
      index: "messages",
      body: {
        mappings: {
          properties: {
            id: { type: "text" },
            message: { type: "text" },
            createdAt: { type: "date" },
          },
        },
      },
    });
    logger.info('Elasticsearch index "messages" created.');
  } else {
    logger.info('Elasticsearch index "messages" already exists.');
  }
};

// Initialize application
mongoose
  .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    logger.info("Connected to MongoDB");
  })
  .then(() => ensureElasticsearchIndex())
  .then(() => {
    // Ensure index exists after starting
    app.listen(PORT, () => {
      logger.info(`Server is running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    logger.error("Initialization error", { error: err.message });
    process.exit(1);
  });

// Application routes
app.get("/", async (req, res) => {
  try {
    const mongoCheck = await Message.findOne({});
    const esHealth = await esClient.cluster.health();
    logger.info("Elasticsearch health response", { esHealth });
    const esStatus = esHealth.status;

    res.status(200).json({
      status: "OK",
      dbSampleMessage: mongoCheck || null,
      elasticsearch: esStatus,
    });
  } catch (err) {
    logger.error("Healthcheck error", { error: err.message });
    res.status(500).json({ status: "ERROR", error: err.message });
  }
});

app.post("/messages", async (req, res) => {
  const { message } = req.body;

  if (!message) {
    logger.warn("POST /messages: Missing message field");
    return res.status(400).json({ error: "Message field is required" });
  }

  try {
    const newMessage = new Message({ message });
    const savedMessage = await newMessage.save();

    await esClient.index({
      index: "messages",
      body: {
        id: savedMessage._id,
        message: savedMessage.message,
        createdAt: savedMessage.createdAt,
      },
    });

    logger.info("Message saved", { message: savedMessage });
    res.status(201).json(savedMessage);
  } catch (err) {
    logger.error("Error saving message", { error: err.message });
    res.status(500).json({ error: "Failed to save message" });
  }
});

app.get("/messages", async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const pageSize = 10;

  try {
    const messages = await Message.find({})
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize);
    logger.info("Fetched messages", { page, pageSize, count: messages.length });
    res.status(200).json(messages);
  } catch (err) {
    logger.error("Error fetching messages", { error: err.message });
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

app.get("/search", async (req, res) => {
  const { text, page = 1 } = req.query;
  const pageSize = 10;

  if (!text) {
    return res.status(400).json({ error: "Text query parameter is required" });
  }

  const request = {
    index: "messages",
    body: {
      query: {
        match: { message: text },
      },
      from: (page - 1) * pageSize,
      size: pageSize,
    },
  };
  try {
    const result = await esClient.search(request);

    // Debugging the full response
    logger.info("Full Elasticsearch response", { request, result });

    const hits = result.hits.hits.map((hit) => hit._source);
    res.status(200).json({ results: hits, total: result.hits.total.value });
  } catch (err) {
    logger.error("Error searching messages", { error: err.message });
    res
      .status(500)
      .json({ error: "Failed to search messages", details: err.message });
  }
});
