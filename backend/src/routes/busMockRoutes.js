const express = require("express");
const router = express.Router();

// Mock Data: Simulating a database or external bus inventory API response
const mockBusInventory = [
  {
    id: "bus_101",
    operator: "KSRTC Airavat",
    type: "A/C Sleeper (2+1)",
    departure: "22:30",
    arrival: "05:15",
    duration: "6h 45m",
    price: 850,
    availableSeats: 12,
    seatLayout: "layout_url_or_array_here",
  },
  {
    id: "bus_102",
    operator: "National Travels",
    type: "Non A/C Seater (2+2)",
    departure: "23:00",
    arrival: "06:00",
    duration: "7h 00m",
    price: 550,
    availableSeats: 4,
    seatLayout: "layout_url_or_array_here",
  },
];

// GET /api/mock/buses/search?source=Bengaluru&destination=Trichy&date=2026-10-15
router.get("/search", (req, res) => {
  const { source, destination, date } = req.query;

  if (!source || !destination || !date) {
    return res.status(400).json({
      success: false,
      message: "Please provide source, destination, and date.",
    });
  }

  // Simulate external API latency so the frontend can exercise loading states
  setTimeout(() => {
    res.status(200).json({
      success: true,
      data: {
        searchParams: { source, destination, date },
        resultsFound: mockBusInventory.length,
        bus_inventory: mockBusInventory,
      },
    });
  }, 1500);
});

module.exports = router;
