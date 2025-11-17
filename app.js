// Global variables
let buildings = [];
let courses = [];
let currentSemester = "202601"; // Default to Fall 2025-26
let legacyRoomsCache = null;
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const dayShortCodes = { M: 0, T: 1, W: 2, R: 3, F: 4 };
const timeSlots = Array.from({ length: 15 }, (_, i) => `${i + 8}:00`);
// Use CORS proxy for development, or direct API for production
const USE_CORS_PROXY = true; // Set to false when deployed
const CORS_PROXY = "https://cors-anywhere.herokuapp.com/";
const API_BASE_URL = "https://pubapps.bucknell.edu/CourseInformation/data/course/term/";

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

    // Load course data from API
    await loadCourseData(currentSemester);

    // Setup event listeners
    document.getElementById("semesterSelect").addEventListener("change", onSemesterChange);
    document.getElementById("buildingSelect").addEventListener("change", onBuildingChange);
    document.getElementById("roomSelect").addEventListener("change", onRoomChange);

    // Initialize schedule grid
    initializeScheduleGrid();
  } catch (error) {
    console.error("Error initializing app:", error);
    document.getElementById("statusMessage").textContent = `Error: ${error.message}`;
    document.getElementById("statusMessage").className = "alert alert-danger";
  }
});

// Load course data from API with CORS proxy fallback
async function loadCourseData(semester) {
  document.getElementById("statusMessage").textContent = `Loading course data for ${getSemesterName(semester)}...`;
  document.getElementById("statusMessage").className = "alert alert-info";

  // Try API with CORS proxy
  try {
    let apiUrl = `${API_BASE_URL}${semester}`;

    // Use CORS proxy if needed (for local development)
    if (USE_CORS_PROXY && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      // Try alternative CORS proxies
      const proxies = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(apiUrl)}`,
        `https://corsproxy.io/?${encodeURIComponent(apiUrl)}`
      ];

      for (const proxyUrl of proxies) {
        try {
          console.log(`Trying CORS proxy: ${proxyUrl}`);
          const courseResponse = await fetch(proxyUrl, {
            headers: {
              'Accept': 'application/json'
            }
          });

          if (courseResponse.ok) {
            const courseData = await courseResponse.json();
            console.log(`Loaded ${courseData.length} courses from API via proxy`);
            courses = normalizeCourseData(courseData);
            const buildingRooms = await buildRoomMap();
            processCourseData(semester, buildingRooms);
            return;
          }
        } catch (proxyError) {
          console.warn(`Proxy failed: ${proxyError.message}`);
          continue;
        }
      }
    } else {
      // Direct API call (should work when deployed)
      const courseResponse = await fetch(apiUrl);
      if (!courseResponse.ok) {
        throw new Error(`Failed to load course data: ${courseResponse.status} ${courseResponse.statusText}`);
      }
      const courseData = await courseResponse.json();
      console.log(`Loaded ${courseData.length} courses from API`);
      courses = normalizeCourseData(courseData);
      const buildingRooms = await buildRoomMap();
      processCourseData(semester, buildingRooms);
      return;
    }

    throw new Error("All API attempts failed");
  } catch (error) {
    console.error("Error loading course data from API:", error);

    // Fallback to CSV parsing for Spring 2025 (only as last resort)
    if (semester === "202605") {
      try {
        const csvResponse = await fetch("courseinformation 2025 (2).csv");
        if (csvResponse.ok) {
          const csvText = await csvResponse.text();
          console.log("Falling back to CSV file");
          courses = parseCSV(csvText);
          if (courses.length > 0) {
            const buildingRooms = await buildRoomMap();
            processCourseData(semester, buildingRooms);
            return;
          }
        }
      } catch (csvError) {
        console.warn("CSV fallback also failed:", csvError);
      }
    }

    // Final fallback to sample data
    document.getElementById("statusMessage").textContent = `Unable to load course data. Using sample data. (CORS issue - will work when deployed)`;
    document.getElementById("statusMessage").className = "alert alert-warning";

    const simpleCourses = createSampleCourses();
    if (simpleCourses.length > 0) {
      courses = simpleCourses;
      console.log(`Using ${courses.length} sample courses instead`);
      const buildingRooms = await buildRoomMap(true);
      processCourseData(semester, buildingRooms);
    }
  }
}

async function buildRoomMap(skipLegacy = false) {
  let buildingRooms = getBuildingRooms(courses, buildings);
  if (!skipLegacy) {
    const legacyRooms = await loadLegacyRooms();
    mergeRoomMaps(buildingRooms, legacyRooms);
  }
  return buildingRooms;
}

async function loadLegacyRooms() {
  if (legacyRoomsCache) {
    return legacyRoomsCache;
  }

  const mergedRooms = {};
  buildings.forEach(b => {
    mergedRooms[b.Code] = [];
  });

  // Load legacy CSV data to capture historical rooms
  try {
    const response = await fetch("courseinformation 2025 (2).csv");
    if (response.ok) {
      const csvText = await response.text();
      const legacyCourses = parseCSV(csvText);
      console.log(`Loaded ${legacyCourses.length} legacy courses from CSV`);
      const legacyRooms = getBuildingRooms(legacyCourses, buildings);
      mergeRoomMaps(mergedRooms, legacyRooms);
    }
  } catch (error) {
    console.warn("Unable to load legacy CSV rooms:", error);
  }

  // Load additional semesters to build a comprehensive room list
  const additionalSemesters = ["202601", "202605"];
  for (const term of additionalSemesters) {
    try {
      const courseData = await fetchTermCourseData(term);
      const normalized = normalizeCourseData(courseData);
      const roomMap = getBuildingRooms(normalized, buildings);
      mergeRoomMaps(mergedRooms, roomMap);
      console.log(`Merged rooms from semester ${term}`);
    } catch (error) {
      console.warn(`Unable to load additional semester ${term}:`, error);
    }
  }

  legacyRoomsCache = mergedRooms;
  return legacyRoomsCache;
}

async function fetchTermCourseData(term) {
  const apiUrl = `${API_BASE_URL}${term}`;
  const urls = [];

  if (USE_CORS_PROXY && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    urls.push(`https://api.allorigins.win/raw?url=${encodeURIComponent(apiUrl)}`);
    urls.push(`https://corsproxy.io/?${encodeURIComponent(apiUrl)}`);
  } else {
    urls.push(apiUrl);
  }

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" }
      });
      if (response.ok) {
        const data = await response.json();
        console.log(`Fetched ${data.length} courses for term ${term}`);
        return data;
      }
    } catch (error) {
      console.warn(`Fetch attempt failed for ${url}:`, error);
      continue;
    }
  }

  throw new Error(`Unable to fetch course data for term ${term}`);
}

function mergeRoomMaps(target, source) {
  if (!source) return;

  Object.entries(source).forEach(([buildingCode, rooms]) => {
    if (!Array.isArray(rooms) || rooms.length === 0) return;

    if (!target[buildingCode]) {
      target[buildingCode] = [];
    }

    rooms.forEach(room => {
      if (!target[buildingCode].includes(room)) {
        target[buildingCode].push(room);
      }
    });

    target[buildingCode].sort((a, b) => {
      const numA = parseInt(a);
      const numB = parseInt(b);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
  });
}

// Process course data and update UI
function processCourseData(semester, buildingRooms) {
  try {
    if (courses.length === 0) {
      throw new Error("No courses found for this semester");
    }

    // Show a few parsed courses for debugging
    console.log("Sample courses:", courses.slice(0, 3));

    // Extract all possible room locations for debugging
    const allLocations = new Set();
    courses.forEach(course => {
      course.meetings.forEach(meeting => {
        if (meeting.location) allLocations.add(meeting.location);
      });
    });
    console.log(`Found ${allLocations.size} unique locations, sample:`,
      Array.from(allLocations).slice(0, 10));

    // Show rooms per building
    const buildingsWithRooms = Object.keys(buildingRooms).filter(code =>
      buildingRooms[code] && buildingRooms[code].length > 0
    );
    console.log(`Found ${buildingsWithRooms.length} buildings with rooms`);

    buildingsWithRooms.forEach(code => {
      console.log(`${code}: ${buildingRooms[code].length} rooms`);
    });

    // Reprocess rooms and update UI
    populateBuildingDropdown(buildingRooms);

    // Clear room selection and schedule
    document.getElementById("roomSelect").value = "";
    document.getElementById("roomSelect").disabled = true;
    clearSchedule();
    document.getElementById("selectedRoom").textContent = "Select a building and room to view availability";

    // Always update status message
    document.getElementById("statusMessage").textContent = `Loaded ${courses.length} courses for ${getSemesterName(semester)}. Select a building and room.`;
    document.getElementById("statusMessage").className = "alert alert-success";
  } catch (error) {
    console.error("Error processing course data:", error);
    document.getElementById("statusMessage").textContent = `Error processing data: ${error.message}`;
    document.getElementById("statusMessage").className = "alert alert-danger";
  }
}

// Normalize JSON API data to match our expected format
function normalizeCourseData(apiData) {
  const normalizedCourses = [];
  let skippedNoMeetings = 0;
  let skippedNoLocation = 0;
  let totalMeetings = 0;
  let validMeetings = 0;

  apiData.forEach(course => {
    // Skip courses without meetings
    if (!course.Meetings || course.Meetings.length === 0) {
      skippedNoMeetings++;
      return;
    }

    const normalizedCourse = {
      subject: course.Subj || "",
      number: course.Number || "",
      title: course.Title || "",
      meetings: []
    };

    // Process each meeting
    course.Meetings.forEach(meeting => {
      totalMeetings++;

      // Skip meetings without location (handle null, undefined, empty string)
      const location = meeting.Location;
      if (!location || location === null || location === undefined || String(location).trim() === "" || String(location).toLowerCase() === "null") {
        skippedNoLocation++;
        return;
      }

      const normalizedMeeting = {
        location: String(location).trim(),
        start: meeting.Start || "",
        end: meeting.End || "",
        days: {}
      };

      // Convert day flags from "Y"/"N" to boolean
      ["M", "T", "W", "R", "F"].forEach(day => {
        normalizedMeeting.days[day] = meeting[day] === "Y";
      });

      normalizedCourse.meetings.push(normalizedMeeting);
      validMeetings++;
    });

    // Only add courses with valid meetings
    if (normalizedCourse.meetings.length > 0) {
      normalizedCourses.push(normalizedCourse);
    }
  });

  console.log(`Normalized ${normalizedCourses.length} courses from ${apiData.length} total courses`);
  console.log(`Meetings: Total=${totalMeetings}, Valid=${validMeetings}, Skipped (no location)=${skippedNoLocation}, Skipped (no meetings)=${skippedNoMeetings}`);

  return normalizedCourses;
}

// Get semester display name
function getSemesterName(termCode) {
  const semesterMap = {
    "202601": "Fall 2025-26",
    "202605": "Spring 2025-26"
  };
  return semesterMap[termCode] || termCode;
}

// Handle semester change
async function onSemesterChange() {
  const newSemester = document.getElementById("semesterSelect").value;
  if (newSemester === currentSemester) {
    return; // No change
  }

  currentSemester = newSemester;
  await loadCourseData(currentSemester);
}

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
  // Create a set of valid building codes (case-insensitive lookup)
  const validBuildingCodes = new Set(buildings.map(b => b.Code));
  const buildingCodeMap = {}; // Map for case-insensitive lookup
  buildings.forEach(b => {
    buildingCodeMap[b.Code.toUpperCase()] = b.Code;
  });
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
  const invalidLocationSamples = new Set();

  // Extract rooms from courses
  courses.forEach(course => {
    course.meetings.forEach(meeting => {
      let location = meeting.location?.trim();
      totalLocations++;

      if (!location || location === "" || location === "null") return;

      // Clean up location - remove extra spaces, handle various formats
      location = location.replace(/\s+/g, " ").trim();

      // Try different parsing strategies
      let buildingCode = null;
      let roomNumber = null;

      // Strategy 1: Split by space (standard format: "DANA 113")
      const parts = location.split(" ");
      if (parts.length >= 2) {
        const potentialCode = parts[0].toUpperCase();
        // Check if first part matches a building code (case-insensitive)
        if (buildingCodeMap[potentialCode]) {
          buildingCode = buildingCodeMap[potentialCode];
          roomNumber = parts.slice(1).join(" ");
        }
      }

      // Strategy 2: If no match, try to find building code at start
      if (!buildingCode) {
        // Try matching building codes of different lengths
        for (let i = 1; i <= location.length; i++) {
          const potentialCode = location.substring(0, i).toUpperCase();
          if (buildingCodeMap[potentialCode]) {
            buildingCode = buildingCodeMap[potentialCode];
            roomNumber = location.substring(i).trim();
            break;
          }
        }
      }

      // If we found a valid building code
      if (buildingCode && roomNumber) {
        validLocations++;

        // Add room if it's not already in the list
        if (!buildingRooms[buildingCode].includes(roomNumber)) {
          buildingRooms[buildingCode].push(roomNumber);
          uniqueRooms++;
        }
      } else {
        invalidLocations++;
        if (invalidLocationSamples.size < 10) {
          invalidLocationSamples.add(location);
        }
      }
    });
  });

  console.log(`Room extraction: Total=${totalLocations}, Valid=${validLocations}, Invalid=${invalidLocations}, Unique=${uniqueRooms}`);
  if (invalidLocationSamples.size > 0) {
    console.log(`Sample invalid locations: ${Array.from(invalidLocationSamples).join(', ')}`);
  }

  // Log rooms per building for verification
  Object.keys(buildingRooms).forEach(code => {
    if (buildingRooms[code].length > 0) {
      console.log(`${code}: ${buildingRooms[code].length} rooms`);
    }
  });

  // Sort room numbers
  Object.keys(buildingRooms).forEach(code => {
    buildingRooms[code].sort((a, b) => {
      // Try to sort numerically if possible
      const numA = parseInt(a);
      const numB = parseInt(b);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      // Try alphanumeric sorting (e.g., "113A" vs "113B")
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
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
