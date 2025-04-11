// Global variables
let buildings = [];
let courses = [];
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const dayShortCodes = { M: 0, T: 1, W: 2, R: 3, F: 4 };
const timeSlots = Array.from({ length: 15 }, (_, i) => `${i + 8}:00`);

// Initialize the app
document.addEventListener("DOMContentLoaded", async () => {
  try {
    document.getElementById("statusMessage").textContent = "Loading data...";
    console.log("App initialization started");

    // Load buildings first
    const buildingsResponse = await fetch("buildings.json");
    buildings = await buildingsResponse.json();
    console.log(`Loaded ${buildings.length} buildings`);

    // Create a proper mapping of building codes for easier lookup
    const buildingCodes = {};
    buildings.forEach(b => buildingCodes[b.Code] = b.Description);
    console.log("Building codes mapping created");

    // Load course data
    document.getElementById("statusMessage").textContent = "Loading course data...";
    try {
      const courseResponse = await fetch("courseinformation 2025 (2).csv");
      if (!courseResponse.ok) {
        throw new Error(`Failed to load CSV: ${courseResponse.status} ${courseResponse.statusText}`);
      }

      const csvText = await courseResponse.text();
      console.log(`Loaded CSV with ${csvText.length} characters`);

      // First 100 characters for debugging
      console.log("CSV starts with:", csvText.substring(0, 100));

      // Parse CSV
      courses = parseCSV(csvText);
      console.log(`Successfully parsed ${courses.length} courses`);

      if (courses.length === 0) {
        throw new Error("No courses parsed from CSV");
      }

      // Show a few parsed courses for debugging
      console.log("Sample courses:", courses.slice(0, 3));
    } catch (csvError) {
      console.error("Error loading CSV:", csvError);
      document.getElementById("statusMessage").textContent = `Error loading course data: ${csvError.message}`;
      document.getElementById("statusMessage").className = "alert alert-danger";

      // Try an alternative approach with a simpler parser
      console.log("Attempting alternative parsing method...");
      const simpleCourses = createSampleCourses();
      if (simpleCourses.length > 0) {
        courses = simpleCourses;
        console.log(`Using ${courses.length} sample courses instead`);
      }
    }

    // Extract all possible room locations for debugging
    const allLocations = new Set();
    courses.forEach(course => {
      course.meetings.forEach(meeting => {
        if (meeting.location) allLocations.add(meeting.location);
      });
    });
    console.log(`Found ${allLocations.size} unique locations, sample:`,
      Array.from(allLocations).slice(0, 10));

    // Process rooms by building
    document.getElementById("statusMessage").textContent = "Processing room data...";
    const buildingRooms = getBuildingRooms(courses, buildings);

    // Show rooms per building
    const buildingsWithRooms = Object.keys(buildingRooms).filter(code =>
      buildingRooms[code] && buildingRooms[code].length > 0
    );
    console.log(`Found ${buildingsWithRooms.length} buildings with rooms`);

    buildingsWithRooms.forEach(code => {
      console.log(`${code}: ${buildingRooms[code].length} rooms`);
    });

    // Populate building dropdown
    populateBuildingDropdown(buildingRooms);

    // Initialize schedule grid
    initializeScheduleGrid();

    // Setup event listeners
    document.getElementById("buildingSelect").addEventListener("change", onBuildingChange);
    document.getElementById("roomSelect").addEventListener("change", onRoomChange);

    document.getElementById("statusMessage").textContent = "Ready! Select a building and room.";
  } catch (error) {
    console.error("Error initializing app:", error);
    document.getElementById("statusMessage").textContent = `Error: ${error.message}`;
    document.getElementById("statusMessage").className = "alert alert-danger";
  }
});

// Create sample courses for testing if CSV loading fails
function createSampleCourses() {
  // Test data to ensure the UI works even if CSV loading fails
  const testCourses = [];

  // Add all buildings and some rooms
  buildings.forEach(building => {
    // Create 5 sample rooms per building
    for (let i = 1; i <= 5; i++) {
      const roomNum = `${i}01`;

      // Create sample course in this room
      testCourses.push({
        subject: "TEST",
        number: `${i}01`,
        title: `Test Course in ${building.Description}`,
        meetings: [{
          location: `${building.Code} ${roomNum}`,
          start: "09:00",
          end: "10:50",
          days: { M: true, T: false, W: true, R: false, F: true }
        }]
      });
    }
  });

  console.log(`Created ${testCourses.length} test courses`);
  return testCourses;
}

// Parse CSV with improved error handling
function parseCSV(csvText) {
  if (!csvText || csvText.trim() === "") {
    console.error("Empty CSV text received");
    return [];
  }

  try {
    // Split by lines and remove empty lines
    const lines = csvText.split("\n").filter(line => line.trim());
    console.log(`CSV has ${lines.length} lines`);

    if (lines.length < 2) {
      console.error("CSV has insufficient lines");
      return [];
    }

    // Skip the first "result" line if present
    const startLine = lines[0].trim() === "result" ? 1 : 0;
    console.log(`Starting CSV parsing from line ${startLine}`);

    // Get the header line
    const headerLine = lines[startLine];
    if (!headerLine) {
      console.error("No header line found in CSV");
      return [];
    }

    // Parse headers, handling potential quoting
    const headers = parseCSVLine(headerLine);
    console.log(`Found ${headers.length} columns in header`);

    // Find required column indices
    const indices = {
      location1: headers.indexOf("Meetings/0/Location"),
      location2: headers.indexOf("Meetings/1/Location"),
      subject: headers.indexOf("Subj"),
      number: headers.indexOf("Number"),
      title: headers.indexOf("Title"),
      start1: headers.indexOf("Meetings/0/Start"),
      end1: headers.indexOf("Meetings/0/End"),
      start2: headers.indexOf("Meetings/1/Start"),
      end2: headers.indexOf("Meetings/1/End")
    };

    // Add day indices
    ["M", "T", "W", "R", "F"].forEach(day => {
      indices[`day1${day}`] = headers.indexOf(`Meetings/0/${day}`);
      indices[`day2${day}`] = headers.indexOf(`Meetings/1/${day}`);
    });

    // Verify that required columns exist
    const requiredColumns = ["location1", "subject", "number"];
    const missingColumns = requiredColumns.filter(col => indices[col] === -1);

    if (missingColumns.length > 0) {
      console.error(`CSV is missing required columns: ${missingColumns.join(", ")}`);
      return [];
    }

    console.log("CSV column indices:", indices);

    // Parse courses from remaining lines
    const parsedCourses = [];
    let successfullyParsed = 0;
    let failedLines = 0;

    for (let i = startLine + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        // Parse CSV line, handling quotes
        const values = parseCSVLine(line);

        // Ensure minimal required fields are present
        if (values.length <= Math.max(indices.location1, indices.subject, indices.number)) {
          console.warn(`Line ${i}: Insufficient columns (${values.length})`);
          failedLines++;
          continue;
        }

        // Create course object
        const course = {
          subject: values[indices.subject] || "",
          number: values[indices.number] || "",
          title: indices.title >= 0 ? values[indices.title] || "" : "",
          meetings: []
        };

        // Process first meeting
        const location1 = values[indices.location1]?.replace(/"/g, '') || "";
        if (location1.trim()) {
          const meeting1 = {
            location: location1.trim(),
            start: indices.start1 >= 0 ? values[indices.start1] || "" : "",
            end: indices.end1 >= 0 ? values[indices.end1] || "" : "",
            days: {}
          };

          // Add days
          ["M", "T", "W", "R", "F"].forEach(day => {
            if (indices[`day1${day}`] >= 0) {
              meeting1.days[day] = values[indices[`day1${day}`]] === "Y";
            }
          });

          course.meetings.push(meeting1);
        }

        // Process second meeting if present
        if (indices.location2 >= 0) {
          const location2 = values[indices.location2]?.replace(/"/g, '') || "";
          if (location2.trim()) {
            const meeting2 = {
              location: location2.trim(),
              start: indices.start2 >= 0 ? values[indices.start2] || "" : "",
              end: indices.end2 >= 0 ? values[indices.end2] || "" : "",
              days: {}
            };

            // Add days
            ["M", "T", "W", "R", "F"].forEach(day => {
              if (indices[`day2${day}`] >= 0) {
                meeting2.days[day] = values[indices[`day2${day}`]] === "Y";
              }
            });

            course.meetings.push(meeting2);
          }
        }

        // Only add courses with actual meetings
        if (course.meetings.length > 0) {
          parsedCourses.push(course);
          successfullyParsed++;
        }
      } catch (lineError) {
        console.warn(`Error parsing line ${i}:`, lineError);
        failedLines++;
      }
    }

    console.log(`CSV parsing completed: ${successfullyParsed} courses parsed, ${failedLines} lines failed`);
    return parsedCourses;
  } catch (error) {
    console.error("Error parsing CSV:", error);
    return [];
  }
}

// Parse a single CSV line, handling quoted fields correctly
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  // Add the last field
  result.push(current);

  // Clean up quotes from all fields
  return result.map(field => field.replace(/^"(.*)"$/, "$1").trim());
}

// Extract rooms by building from courses
function getBuildingRooms(courses, buildings) {
  // Create a set of valid building codes
  const validBuildingCodes = new Set(buildings.map(b => b.Code));
  console.log(`Valid building codes: ${Array.from(validBuildingCodes).join(', ')}`);

  // Initialize room map
  const buildingRooms = {};
  buildings.forEach(b => {
    buildingRooms[b.Code] = [];
  });

  // Counters for reporting
  let totalLocations = 0;
  let validLocations = 0;
  let invalidLocations = 0;
  let uniqueRooms = 0;

  // Extract rooms from courses
  courses.forEach(course => {
    course.meetings.forEach(meeting => {
      const location = meeting.location?.trim();
      totalLocations++;

      if (!location) return;

      // Split location into building and room
      const parts = location.split(" ");
      if (parts.length < 2) {
        invalidLocations++;
        return;
      }

      const buildingCode = parts[0];
      const roomNumber = parts.slice(1).join(" ");

      // Check if this is a valid building
      if (validBuildingCodes.has(buildingCode)) {
        validLocations++;

        // Add room if it's not already in the list
        if (!buildingRooms[buildingCode].includes(roomNumber)) {
          buildingRooms[buildingCode].push(roomNumber);
          uniqueRooms++;
        }
      } else {
        invalidLocations++;
      }
    });
  });

  console.log(`Room extraction: Total=${totalLocations}, Valid=${validLocations}, Invalid=${invalidLocations}, Unique=${uniqueRooms}`);

  // Sort room numbers
  Object.keys(buildingRooms).forEach(code => {
    buildingRooms[code].sort((a, b) => {
      // Try to sort numerically if possible
      const numA = parseInt(a);
      const numB = parseInt(b);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a.localeCompare(b);
    });
  });

  return buildingRooms;
}

// Populate building dropdown
function populateBuildingDropdown(buildingRooms) {
  const select = document.getElementById("buildingSelect");
  select.innerHTML = '<option value="">Select a building...</option>';

  // Get buildings with rooms
  const availableBuildings = buildings.filter(b =>
    buildingRooms[b.Code] && buildingRooms[b.Code].length > 0
  );

  if (availableBuildings.length === 0) {
    // If no buildings with rooms found, show all buildings
    console.warn("No buildings with rooms found, showing all buildings");
    availableBuildings.push(...buildings);
  }

  // Sort by name
  availableBuildings.sort((a, b) => a.Description.localeCompare(b.Description));

  // Add to dropdown
  availableBuildings.forEach(building => {
    const option = document.createElement("option");
    option.value = building.Code;
    option.textContent = `${building.Description} (${building.Code})`;
    select.appendChild(option);
  });

  select.disabled = false;
  console.log(`Added ${availableBuildings.length} buildings to dropdown`);
}

// Handle building selection change
function onBuildingChange() {
  const buildingCode = document.getElementById("buildingSelect").value;
  const roomSelect = document.getElementById("roomSelect");

  // Clear room select
  roomSelect.innerHTML = '<option value="">Select a room...</option>';
  roomSelect.disabled = !buildingCode;

  if (!buildingCode) {
    clearSchedule();
    document.getElementById("selectedRoom").textContent = "Select a building and room to view availability";
    return;
  }

  // Get building info
  const building = buildings.find(b => b.Code === buildingCode);

  // Get rooms for this building
  const buildingRooms = getBuildingRooms(courses, buildings);
  let rooms = buildingRooms[buildingCode] || [];

  console.log(`Building ${buildingCode} has ${rooms.length} rooms`);

  // Add rooms to dropdown
  rooms.forEach(room => {
    const option = document.createElement("option");
    option.value = room;
    option.textContent = room;
    roomSelect.appendChild(option);
  });

  document.getElementById("selectedRoom").textContent = `${building.Description} - Select a room`;
  document.getElementById("statusMessage").textContent = `${rooms.length} rooms available in ${building.Description}`;
}

// Handle room selection change
function onRoomChange() {
  try {
    console.log("Room selection changed");
    const buildingCode = document.getElementById("buildingSelect").value;
    const roomNumber = document.getElementById("roomSelect").value;

    console.log(`Selected building: ${buildingCode}, room: ${roomNumber}`);

    if (!buildingCode || !roomNumber) {
      clearSchedule();
      return;
    }

    const building = buildings.find(b => b.Code === buildingCode);
    if (!building) {
      console.error(`Building with code ${buildingCode} not found!`);
      document.getElementById("statusMessage").textContent = `Error: Building ${buildingCode} not found`;
      document.getElementById("statusMessage").className = "alert alert-danger";
      return;
    }

    const fullRoomCode = `${buildingCode} ${roomNumber}`;
    console.log(`Full room code: ${fullRoomCode}`);

    // Display room schedule
    displayRoomSchedule(fullRoomCode, building.Description);
  } catch (error) {
    console.error("Error in room change handler:", error);
    document.getElementById("statusMessage").textContent = `Error: ${error.message}`;
    document.getElementById("statusMessage").className = "alert alert-danger";
  }
}

// Display schedule for a room
function displayRoomSchedule(roomCode, buildingName) {
  clearSchedule();

  // Find matching courses (case insensitive)
  const normalizedRoomCode = roomCode.trim().toUpperCase();
  const matchingCourses = courses.filter(course =>
    course.meetings.some(m =>
      m.location?.trim().toUpperCase() === normalizedRoomCode
    )
  );

  console.log(`Found ${matchingCourses.length} courses for room ${roomCode}`);

  // Update room title
  document.getElementById("selectedRoom").textContent = `${buildingName} - Room ${roomCode.split(' ')[1]}`;

  // Update status message
  document.getElementById("statusMessage").textContent =
    matchingCourses.length === 0
      ? `No classes found in ${roomCode} - it's available all day!`
      : `Found ${matchingCourses.length} courses in ${roomCode}`;

  // Display courses on schedule
  populateSchedule(matchingCourses, roomCode);
}

// Populate schedule with courses
function populateSchedule(courses, roomCode) {
  console.log("Attempting to populate schedule for", roomCode);

  // Get all cells in the grid
  const grid = document.getElementById("scheduleGrid");
  if (!grid) {
    console.error("Schedule grid not found!");
    return;
  }

  // Clear all cells first
  clearSchedule();

  let slotsOccupied = 0;

  // Loop through courses and mark occupied slots
  courses.forEach(course => {
    course.meetings.forEach(meeting => {
      // Skip if not for this room (case insensitive)
      if (meeting.location?.trim().toUpperCase() !== roomCode.trim().toUpperCase()) return;

      // Skip if missing times
      if (!meeting.start || !meeting.end) return;

      // Get time range (convert to 8-based index)
      const startHour = parseInt(meeting.start.substring(0, 2)) - 8;
      const endHour = parseInt(meeting.end.substring(0, 2)) - 8;

      console.log(`Course ${course.subject} ${course.number} - Time: ${meeting.start}-${meeting.end}, Hours: ${startHour}-${endHour}`);

      // Skip if outside our display range
      if (startHour < 0 || endHour > 14) {
        console.warn(`Course outside display range: ${startHour}-${endHour}`);
        return;
      }

      // For each day this course meets
      Object.entries(meeting.days).forEach(([day, meets]) => {
        if (!meets) return;

        const dayIndex = dayShortCodes[day];
        if (dayIndex === undefined) {
          console.warn(`Unknown day code: ${day}`);
          return;
        }

        console.log(`Course ${course.subject} ${course.number} on ${day} (index ${dayIndex})`);

        // Mark cells for each hour in the time range
        for (let hour = startHour; hour <= endHour; hour++) {
          // Get the cells by position in the grid
          // Each row has 6 cells (1 time + 5 days)
          // First row (index 0-5) contains headers
          // Then each row starts with a time cell followed by 5 day cells

          // Formula: Skip header row (6 cells) + current row's cells (row * 6) + day offset
          // Row is hour (0-14), day offset is dayIndex + 1 (to skip time cell)
          const cellIndex = 6 + (hour * 6) + dayIndex + 1;

          console.log(`Looking for cell at index ${cellIndex} (hour ${hour}, day ${dayIndex})`);

          if (cellIndex < grid.children.length) {
            const cell = grid.children[cellIndex];
            if (cell) {
              cell.className = 'occupied';
              cell.textContent = `${course.subject} ${course.number}`;
              slotsOccupied++;
              console.log(`Marked cell at index ${cellIndex} as occupied`);
            }
          }
        }
      });
    });
  });

  // Update status message
  if (slotsOccupied > 0) {
    document.getElementById("statusMessage").textContent =
      `Found ${courses.length} courses using this room (${slotsOccupied} time slots occupied)`;
    document.getElementById("statusMessage").className = "alert alert-success";
    console.log(`Populated ${slotsOccupied} time slots`);
  } else {
    document.getElementById("statusMessage").textContent =
      `No classes found in ${roomCode} - it's available all day!`;
    document.getElementById("statusMessage").className = "alert alert-info";
    console.log("No slots were populated with courses");
  }
}

// Clear schedule
function clearSchedule() {
  const grid = document.getElementById("scheduleGrid");
  if (!grid) {
    console.error("Schedule grid element not found!");
    return;
  }

  // Loop through all grid cells
  Array.from(grid.children).forEach((cell, index) => {
    // Skip header row and time column cells
    if (index < 6 || index % 6 === 0) {
      return; // Skip headers and time cells
    }

    // Reset all content cells
    cell.className = 'available';
    cell.textContent = '';
  });

  console.log("Schedule cleared");
}

// Initialize schedule grid
function initializeScheduleGrid() {
  console.log("Initializing schedule grid");

  const grid = document.getElementById("scheduleGrid");
  if (!grid) {
    console.error("Schedule grid element not found!");
    return;
  }

  grid.innerHTML = '';

  // Add header row
  const headerRow = document.createElement("div");
  headerRow.className = "header";
  headerRow.textContent = "Time";
  grid.appendChild(headerRow);

  // Add day headers
  days.forEach(day => {
    const dayHeader = document.createElement("div");
    dayHeader.className = "header";
    dayHeader.textContent = day;
    grid.appendChild(dayHeader);
  });

  // Add time slots
  timeSlots.forEach(time => {
    const timeCell = document.createElement("div");
    timeCell.className = "time-slot";
    timeCell.textContent = time;
    grid.appendChild(timeCell);

    // Add day cells for this time
    for (let i = 0; i < 5; i++) {
      const dayCell = document.createElement("div");
      dayCell.className = "available";
      grid.appendChild(dayCell);
    }
  });

  console.log(`Grid initialized with ${timeSlots.length} time slots and ${days.length} days`);
  console.log(`Total cells: ${timeSlots.length * days.length + timeSlots.length + days.length + 1}`);
}
