const mongoose = require("mongoose");

// One distilled fact/preference about a user, embedded so chat requests can
// pull back only what's relevant to the current message instead of dumping
// every memory into every prompt (see memoryService.retrieveRelevant).
const memorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    content: {
      type: String,
      required: true,
      maxlength: 500,
    },
    embedding: {
      type: [Number],
      default: [],
    },
    source: {
      type: String,
      enum: ["manual", "auto"],
      default: "manual",
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.userId;
        delete ret.embedding;
        return ret;
      },
    },
  }
);

module.exports = mongoose.model("Memory", memorySchema);
