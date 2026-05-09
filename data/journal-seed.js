(function () {
  const travelRecord = window.ICELAND_TRAVEL_RECORD;
  const journalSeed = {};

  if (!travelRecord || !Array.isArray(travelRecord.days)) {
    window.ICELAND_TRIP_JOURNAL_SEED = journalSeed;
    return;
  }

  const tripYearMatch = String(travelRecord.period || "").match(/(\d{4})\//);
  const tripYear = tripYearMatch ? Number(tripYearMatch[1]) : 2026;
  const importedAt = "2026-05-06T18:30:00+09:00";
  const spotMappings = {
    "day-1": [
      { spotId: "spot-1", entryIndexes: [0] },
      { spotId: "spot-2", entryIndexes: [1] },
      { spotId: "spot-17", entryIndexes: [2] },
      { spotId: "spot-3", entryIndexes: [3] }
    ],
    "day-2": [
      { spotId: "spot-4", entryIndexes: [0] },
      { spotId: "spot-18", entryIndexes: [1] },
      { spotId: "spot-5", entryIndexes: [2] },
      { spotId: "spot-6", entryIndexes: [3] },
      { spotId: "spot-7", entryIndexes: [4, 5] }
    ],
    "day-3": [
      { spotId: "spot-10", entryIndexes: [0, 1] },
      { spotId: "spot-19", entryIndexes: [2] },
      { spotId: "spot-20", entryIndexes: [3, 4, 5, 6] },
      { spotId: "spot-13", entryIndexes: [7, 8] }
    ],
    "day-4": [
      { spotId: "spot-12", entryIndexes: [0, 1, 2, 3, 4, 5] },
      { spotId: "spot-21", entryIndexes: [6] }
    ],
    "day-5": [
      { spotId: "spot-22", entryIndexes: [0, 1, 2] },
      { spotId: "spot-23", entryIndexes: [3] },
      { spotId: "spot-9", entryIndexes: [4, 5] },
      { spotId: "spot-8", entryIndexes: [6, 7] },
      { spotId: "spot-24", entryIndexes: [8, 9] },
      { spotId: "spot-15", entryIndexes: [10, 11, 12, 13, 14] },
      { spotId: "spot-25", entryIndexes: [15, 16, 17, 18, 19, 20, 21, 22, 23] }
    ],
    "day-6": [
      { spotId: "spot-16", entryIndexes: [0, 1, 2, 3, 4, 5, 6] }
    ]
  };

  function ensureSeedList(spotId) {
    if (!Array.isArray(journalSeed[spotId])) {
      journalSeed[spotId] = [];
    }
    return journalSeed[spotId];
  }

  function buildVisitedAt(dayLabel, timeText) {
    const datePart = String(dayLabel || "").split("-")[0].trim();
    const dateMatch = datePart.match(/(\d{1,2})\/(\d{1,2})/);
    const timeMatch = String(timeText || "").match(/(\d{1,2}):(\d{2})/);

    if (!dateMatch) {
      return importedAt;
    }

    const month = String(Number(dateMatch[1])).padStart(2, "0");
    const day = String(Number(dateMatch[2])).padStart(2, "0");
    const hours = String(timeMatch ? Number(timeMatch[1]) : 12).padStart(2, "0");
    const minutes = String(timeMatch ? Number(timeMatch[2]) : 0).padStart(2, "0");

    return `${tripYear}-${month}-${day}T${hours}:${minutes}:00+09:00`;
  }

  function extractComment(entry) {
    const background = String(entry && entry.background ? entry.background : "").trim();
    const match = background.match(/\*\*コメント\*\*:\s*([\s\S]+)$/);
    return match ? match[1].trim() : "";
  }

  function buildComment(entry) {
    const parts = [];
    const title = String(entry && entry.title ? entry.title : "").trim();
    const note = String(entry && entry.note ? entry.note : "").trim();
    const comment = extractComment(entry);

    if (title && title !== "追加写真") {
      parts.push(title);
    }

    if (note) {
      parts.push(note);
    }

    if (comment) {
      parts.push(`**コメント**: ${comment}`);
    }

    return parts.join("\n").trim();
  }

  function buildPhotoName(entry, dayId, entryIndex) {
    if (entry && typeof entry.filename === "string" && entry.filename) {
      return entry.filename;
    }

    if (entry && typeof entry.image === "string") {
      const imageParts = entry.image.split("/");
      return imageParts[imageParts.length - 1] || `${dayId}-${entryIndex + 1}.jpg`;
    }

    return `${dayId}-${entryIndex + 1}.jpg`;
  }

  function appendSeedEntry(spotId, day, entry, entryIndex) {
    if (!entry || typeof entry.image !== "string" || !entry.image) {
      return;
    }

    ensureSeedList(spotId).push({
      id: `seed-${spotId}-${day.id}-${entryIndex + 1}`,
      spotId,
      visitedAt: buildVisitedAt(day.date, entry.time),
      uploadedAt: importedAt,
      updatedAt: importedAt,
      photoName: buildPhotoName(entry, day.id, entryIndex),
      photoUrl: entry.image,
      comment: buildComment(entry),
      readOnly: true,
      sourceLabel: "旅行メモから登録済み"
    });
  }

  Object.entries(spotMappings).forEach(([dayId, mappings]) => {
    const day = travelRecord.days.find((item) => item.id === dayId);
    if (!day || !Array.isArray(day.entries)) {
      return;
    }

    mappings.forEach(({ spotId, entryIndexes }) => {
      entryIndexes.forEach((entryIndex) => {
        appendSeedEntry(spotId, day, day.entries[entryIndex], entryIndex);
      });
    });
  });

  window.ICELAND_TRIP_JOURNAL_SEED = journalSeed;
})();
