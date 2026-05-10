const mongoose = require("mongoose");

const chatSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
      unique: true,
    },
    title: {
      type: String,
      default: "New Chat",
    },
    messages: {
      type: Array,
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = ret.sessionId;
        delete ret._id;
        delete ret.userId;
        return ret;
      },
    },
  }
);

module.exports = mongoose.model("ChatSession", chatSessionSchema);
