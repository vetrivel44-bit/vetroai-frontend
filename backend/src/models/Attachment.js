const mongoose = require("mongoose");

// A file uploaded once and kept for the rest of its chat session, so later
// messages in the same session can reference it without the user
// re-attaching it on every turn (see chatController's use of listForSession).
const attachmentSchema = new mongoose.Schema(
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
      index: true,
    },
    filename: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    extractedText: {
      type: String,
      default: "",
      maxlength: 20000,
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
        return ret;
      },
    },
  }
);

attachmentSchema.index({ userId: 1, sessionId: 1 });

module.exports = mongoose.model("Attachment", attachmentSchema);
