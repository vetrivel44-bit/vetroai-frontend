const mongoose = require("mongoose");

// Price points for one product at one store (or, with kind "query", the
// cheapest offer found for one search), recorded by the hourly deals refresh.
const priceHistorySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    kind: { type: String, enum: ["product", "query"], default: "product" },
    region: { type: String, default: "in" },
    title: { type: String, default: "" },
    store: { type: String, default: "" },
    // { p: price, t: Date } — newest last, capped by the service.
    points: { type: [{ _id: false, p: Number, t: Date }], default: [] },
    // Lowest price ever recorded; kept separately so trimming old points
    // never loses it.
    low: { _id: false, p: Number, t: Date },
    high: { _id: false, p: Number, t: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.models.PriceHistory || mongoose.model("PriceHistory", priceHistorySchema);
