// Initialize Day.js plugins
dayjs.extend(window.dayjs_plugin_utc);
dayjs.extend(window.dayjs_plugin_timezone);
dayjs.extend(window.dayjs_plugin_customParseFormat);

// Standard list of IANA Timezones for Search Dropdowns
const COMMON_TIMEZONES = [
    "Africa/Cairo", "Africa/Johannesburg", "Africa/Nairobi",
    "America/Argentina/Buenos_Aires", "America/Bogota", "America/Chicago", 
    "America/Denver", "America/Los_Angeles", "America/Mexico_City", 
    "America/New_York", "America/Phoenix", "America/Sao_Paulo", "America/Toronto", "America/Vancouver",
    "Asia/Bangkok", "Asia/Dubai", "Asia/Hong_Kong", "Asia/Jakarta", "Asia/Jerusalem",
    "Asia/Kolkata", "Asia/Manila", "Asia/Riyadh", "Asia/Seoul", "Asia/Shanghai", 
    "Asia/Singapore", "Asia/Taipei", "Asia/Tokyo",
    "Atlantic/Reykjavik",
    "Australia/Adelaide", "Australia/Brisbane", "Australia/Melbourne", "Australia/Perth", "Australia/Sydney",
    "Europe/Amsterdam", "Europe/Athens", "Europe/Berlin", "Europe/Brussels", "Europe/Budapest",
    "Europe/Copenhagen", "Europe/Dublin", "Europe/Helsinki", "Europe/Istanbul", "Europe/London", 
    "Europe/Madrid", "Europe/Moscow", "Europe/Paris", "Europe/Rome", "Europe/Stockholm", "Europe/Zurich",
    "Pacific/Auckland", "Pacific/Honolulu"
];

// Global State
let calculatedEvents = [];
let currentPrepDays = 0;
let timeDifferenceHours = 0;
let isPhaseAdvance = true;
let departureTz = "";
let arrivalTz = "";

document.addEventListener("DOMContentLoaded", () => {
    // Detect local timezone on load
    const localTz = dayjs.tz.guess() || "Europe/London";
    document.getElementById("dept-tz").value = localTz;
    departureTz = localTz;
    
    // Set default flight dates (Departure: 5 days from now, Arrival: 6 days from now)
    const now = dayjs();
    const defaultDept = now.add(5, 'day').hour(22).minute(30).second(0);
    const defaultArr = now.add(6, 'day').hour(16).minute(30).second(0);
    
    document.getElementById("dept-datetime").value = defaultDept.format("YYYY-MM-DDTHH:mm");
    document.getElementById("arr-datetime").value = defaultArr.format("YYYY-MM-DDTHH:mm");
    
    // Default destination
    document.getElementById("arr-tz").value = "Asia/Shanghai";
    arrivalTz = "Asia/Shanghai";

    // Setup searchable dropdowns
    setupTzAutocomplete("dept-tz", "dept-tz-dropdown");
    setupTzAutocomplete("arr-tz", "arr-tz-dropdown");

    // Click handler for Generate button
    document.getElementById("btn-generate").addEventListener("click", generateSchedule);
    // Click handler for Export button
    document.getElementById("btn-export").addEventListener("click", exportToIcs);
    
    // Init icons
    lucide.createIcons();
});

// Setup TZ Autocomplete dropdown
function setupTzAutocomplete(inputId, dropdownId) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    
    // Create dropdown list items
    function populateDropdown(filterText = "") {
        dropdown.innerHTML = "";
        const filtered = COMMON_TIMEZONES.filter(tz => 
            tz.toLowerCase().includes(filterText.toLowerCase())
        );
        
        if (filtered.length === 0) {
            dropdown.classList.add("hidden");
            return;
        }
        
        filtered.forEach(tz => {
            const item = document.createElement("div");
            item.textContent = tz;
            item.addEventListener("click", () => {
                input.value = tz;
                if (inputId === "dept-tz") departureTz = tz;
                if (inputId === "arr-tz") arrivalTz = tz;
                dropdown.classList.add("hidden");
            });
            dropdown.appendChild(item);
        });
        dropdown.classList.remove("hidden");
    }

    input.addEventListener("input", (e) => {
        populateDropdown(e.target.value);
    });

    input.addEventListener("focus", () => {
        populateDropdown(input.value);
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
        if (e.target !== input && e.target !== dropdown) {
            dropdown.classList.add("hidden");
        }
    });
}

// Main Algorithm Engine
function generateSchedule() {
    const sleepInput = document.getElementById("usual-sleep").value;
    const wakeInput = document.getElementById("usual-wake").value;
    const deptTimeInput = document.getElementById("dept-datetime").value;
    const arrTimeInput = document.getElementById("arr-datetime").value;
    
    // Read selections
    departureTz = document.getElementById("dept-tz").value;
    arrivalTz = document.getElementById("arr-tz").value;
    const speed = parseFloat(document.getElementById("shift-speed").value);
    const useMelatonin = document.getElementById("use-melatonin").checked;
    const useCaffeine = document.getElementById("use-caffeine").checked;

    // Validate timezones
    try {
        dayjs().tz(departureTz);
    } catch(e) {
        alert("无效的出发地时区，请输入正确的 IANA 时区（如 Europe/London）");
        return;
    }
    try {
        dayjs().tz(arrivalTz);
    } catch(e) {
        alert("无效的目的地时区，请输入正确的 IANA 时区（如 Asia/Shanghai）");
        return;
    }

    // Parse date objects
    const deptTime = dayjs.tz(deptTimeInput, departureTz);
    const arrTime = dayjs.tz(arrTimeInput, arrivalTz);
    
    if (arrTime.isBefore(deptTime)) {
        alert("降落时间不能早于起飞时间！请检查输入。");
        return;
    }

    // Calculate timezone difference at travel time
    const deptOffset = deptTime.utcOffset(); // minutes
    const arrOffset = arrTime.utcOffset();   // minutes
    const rawTzDiff = (arrOffset - deptOffset) / 60; // hours
    
    // Normalize time difference to [-12, +12]
    let tzDiff = rawTzDiff;
    if (tzDiff > 12) tzDiff -= 24;
    if (tzDiff < -12) tzDiff += 24;
    
    timeDifferenceHours = tzDiff;
    
    // Determine advance vs delay
    // If shift is more than 9 hours, it's biologically easier to shift in the opposite direction (delay)
    if (tzDiff > 0) {
        if (tzDiff <= 9) {
            isPhaseAdvance = true; // Eastward Advance
        } else {
            isPhaseAdvance = false; // Shift Westward instead
            timeDifferenceHours = tzDiff - 24; // e.g. +10 becomes -14
        }
    } else {
        if (tzDiff >= -9) {
            isPhaseAdvance = false; // Westward Delay
        } else {
            isPhaseAdvance = true; // Shift Eastward instead
            timeDifferenceHours = 24 + tzDiff; // e.g. -10 becomes +14
        }
    }

    // Calculate prep days needed
    const totalShiftNeeded = Math.abs(timeDifferenceHours);
    currentPrepDays = Math.ceil(totalShiftNeeded / speed);

    // Compute baseline Tmin (in local/origin timezone)
    const [wakeH, wakeM] = wakeInput.split(":").map(Number);
    const [sleepH, sleepM] = sleepInput.split(":").map(Number);
    
    // Standard normal Tmin is 2 hours before habitual wake time
    let normalTminMinutes = (wakeH * 60 + wakeM - 120 + 1440) % 1440;
    const normalTminStr = `${String(Math.floor(normalTminMinutes / 60)).padStart(2, '0')}:${String(normalTminMinutes % 60).padStart(2, '0')}`;

    // Reset global schedule list
    calculatedEvents = [];

    // 1. Generate Pre-adaptation Days
    // Preparation starts (currentPrepDays) days before departure day.
    // Each day k (1 to prepDays), we shift sleep/wake times.
    const startPrepDate = deptTime.subtract(currentPrepDays, 'day').startOf('day');

    for (let k = 0; k < currentPrepDays; k++) {
        const currentDay = startPrepDate.add(k, 'day');
        const currentShift = k * speed * (isPhaseAdvance ? -1 : 1); // negative shift means earlier (advance)
        
        // Calculate sleep start/end times for this prep day
        const daySleepStart = addHoursToTimeStr(sleepInput, currentShift);
        const daySleepEnd = addHoursToTimeStr(wakeInput, currentShift);
        
        const sleepStartDt = combineDateAndTime(currentDay, daySleepStart, departureTz);
        let sleepEndDt = combineDateAndTime(currentDay, daySleepEnd, departureTz);
        if (sleepEndDt.isBefore(sleepStartDt)) {
            sleepEndDt = sleepEndDt.add(1, 'day');
        }

        const tminDt = sleepEndDt.subtract(2, 'hour');

        // Add Sleep block
        calculatedEvents.push({
            dayIndex: k - currentPrepDays,
            type: "sleep",
            title: `【睡眠】睡眠时间 (${daySleepStart} - ${daySleepEnd})`,
            description: `今晚预适应睡眠目标：当地时间 ${daySleepStart} 至次日 ${daySleepEnd}。`,
            start: sleepStartDt,
            end: sleepEndDt
        });

        // Add Melatonin block
        if (useMelatonin) {
            const melStart = sleepStartDt.subtract(1, 'hour');
            calculatedEvents.push({
                dayIndex: k - currentPrepDays,
                type: "melatonin",
                title: "【吃药】服用褪黑素 (1.0mg)",
                description: `服用1.0mg褪黑素以向大脑发出强烈的夜晚信号，辅助时钟前移。`,
                start: melStart,
                end: melStart.add(15, 'minute')
            });
        }

        // Add Light exposure & avoidance blocks
        if (isPhaseAdvance) {
            // Seek Light: right after waking up for 4 hours
            const seekStart = sleepEndDt;
            const seekEnd = sleepEndDt.add(4, 'hour');
            calculatedEvents.push({
                dayIndex: k - currentPrepDays,
                type: "seek",
                title: "【暴露光】寻求光照 / 强光暴露",
                description: "醒来后立即晒太阳或暴露在最亮强光下，以加速生物钟前移。",
                start: seekStart,
                end: seekEnd
            });

            // Avoid Light: 5 hours before bedtime
            const avoidStart = sleepStartDt.subtract(5, 'hour');
            const avoidEnd = sleepStartDt;
            calculatedEvents.push({
                dayIndex: k - currentPrepDays,
                type: "avoid",
                title: "【避光】开始有规律避光 / 减少阳光",
                description: "限制亮光接触（建议佩戴墨镜或防蓝光镜片），防止傍晚强光延迟生物钟。",
                start: avoidStart,
                end: avoidEnd
            });

            // Caffeine
            if (useCaffeine) {
                calculatedEvents.push({
                    dayIndex: k - currentPrepDays,
                    type: "caffeine",
                    title: "【日常】摄入咖啡因 & 避开期",
                    description: `上午可摄入咖啡因提神。但建议在睡前 6 小时内（即 ${sleepStartDt.subtract(6, 'hour').format("HH:mm")} 之后）绝对禁止咖啡因。`,
                    start: seekStart,
                    end: seekEnd
                });
            }
        } else {
            // Phase Delay (shifting later)
            // Seek Light: 4 hours before bedtime (subjective evening)
            const seekStart = sleepStartDt.subtract(4, 'hour');
            const seekEnd = sleepStartDt;
            calculatedEvents.push({
                dayIndex: k - currentPrepDays,
                type: "seek",
                title: "【暴露光】寻求光照 / 强光暴露",
                description: "在主观傍晚晒太阳或暴露在最亮灯光下，促使生物钟往后延迟。",
                start: seekStart,
                end: seekEnd
            });

            // Avoid Light: 4 hours after waking (subjective morning)
            const avoidStart = sleepEndDt;
            const avoidEnd = sleepEndDt.add(4, 'hour');
            calculatedEvents.push({
                dayIndex: k - currentPrepDays,
                type: "avoid",
                title: "【避光】开始有规律避光 / 减少阳光",
                description: "醒来后数小时内建议避光（戴墨镜），防止清晨阳光过早前移生物钟。",
                start: avoidStart,
                end: avoidEnd
            });

            // Caffeine
            if (useCaffeine) {
                calculatedEvents.push({
                    dayIndex: k - currentPrepDays,
                    type: "caffeine",
                    title: "【日常】摄入咖啡因 & 避开期",
                    description: `在主观下午 ${sleepEndDt.add(4, 'hour').format("HH:mm")} 后可使用咖啡因。建议在睡前 6 小时内（即 ${sleepStartDt.subtract(6, 'hour').format("HH:mm")} 之后）禁止使用。`,
                    start: sleepEndDt.add(4, 'hour'),
                    end: sleepStartDt.subtract(6, 'hour')
                });
            }
        }
    }

    // 2. Generate Departure and Flight Days (June 15 - June 16)
    // Shift is fully completed to destination zone target.
    // The target sleep schedule is now fully shifted to destination time.
    const destSleepStart = sleepInput;
    const destSleepEnd = wakeInput;

    const flightDay = deptTime.startOf('day');
    
    // We schedule a pre-flight nap for the flight day
    // Sleep window in origin timezone that matches target sleep time:
    // Target sleep is destSleepStart in destination timezone.
    // Convert destSleepStart in destination timezone on departure day to departure timezone.
    let targetSleepStartDestTz = dayjs.tz(flightDay.format("YYYY-MM-DD") + " " + destSleepStart, arrivalTz);
    let targetSleepEndDestTz = dayjs.tz(flightDay.format("YYYY-MM-DD") + " " + destSleepEnd, arrivalTz);
    if (targetSleepEndDestTz.isBefore(targetSleepStartDestTz)) {
        targetSleepEndDestTz = targetSleepEndDestTz.add(1, 'day');
    }

    const targetSleepStartDeptTz = targetSleepStartDestTz.tz(departureTz);
    const targetSleepEndDeptTz = targetSleepEndDestTz.tz(departureTz);

    const deptTzShort = departureTz.split("/").pop().replace(/_/g, " ");
    const arrTzShort = arrivalTz.split("/").pop().replace(/_/g, " ");

    // If target sleep is during the day in origin, user should nap.
    // Let's create the schedule for Departure Day
    
    let napStart = targetSleepStartDeptTz;
    let napEnd = targetSleepEndDeptTz;
    const maxNapEnd = deptTime.subtract(2, 'hour');
    
    if (napEnd.isAfter(maxNapEnd)) {
        napEnd = maxNapEnd;
    }
    
    const napDurationMinutes = napEnd.diff(napStart, 'minute');
    if (napDurationMinutes >= 30) {
        // Pre-flight Melatonin
        if (useMelatonin) {
            const preFlightMel = napStart.subtract(1, 'hour');
            calculatedEvents.push({
                dayIndex: 0,
                type: "melatonin",
                title: "【吃药】出发前服用褪黑素 (1.0mg)",
                description: "服用1.0mg褪黑素，为接下来的出发前小睡打下基础。",
                start: preFlightMel,
                end: preFlightMel.add(15, 'minute')
            });
        }

        // Pre-flight Nap
        calculatedEvents.push({
            dayIndex: 0,
            type: "sleep",
            title: `【睡眠】出发前小睡 (${napStart.format("HH:mm")} - ${napEnd.format("HH:mm")} ${deptTzShort})`,
            description: `在出发前进行一次约 ${(napDurationMinutes / 60).toFixed(1)} 小时的小睡，补充睡眠储备，确保飞行途中能保持清醒。`,
            start: napStart,
            end: napEnd
        });
    }

    // Flight block
    calculatedEvents.push({
        dayIndex: 0,
        type: "flight",
        title: "【航班】乘机飞行中",
        description: `从出发地乘机飞往目的地，于当地时间 ${arrTime.format("MM-DD HH:mm")} 降落。`,
        start: deptTime,
        end: arrTime
    });

    // Melatonin on flight takeoff
    if (useMelatonin) {
        calculatedEvents.push({
            dayIndex: 0,
            type: "melatonin",
            title: "【吃药】机上服用褪黑素 (1.0mg)",
            description: "起飞后立刻服用 1.0mg 褪黑素并开始机上第一段睡眠。",
            start: deptTime,
            end: deptTime.add(15, 'minute')
        });
    }

    // Sleep on flight (Option B: sleep first 4 hours)
    const flightSleepEnd = deptTime.add(4, 'hour');
    calculatedEvents.push({
        dayIndex: 0,
        type: "sleep",
        title: "【睡眠】机上前半程睡眠",
        description: "戴好耳塞和眼罩，立刻入睡。目标在飞机上睡满 4 小时，以便清晨精神饱满地醒来。",
        start: deptTime,
        end: flightSleepEnd
    });

    // Stay awake on flight (Option B: stay awake second half)
    calculatedEvents.push({
        dayIndex: 1,
        type: "seek",
        title: "【暴露光】机上强行清醒并寻求光照",
        description: `当地时间 ${flightSleepEnd.tz(arrivalTz).format("HH:mm")}。必须醒来！拉开舷窗遮光板，调亮屏幕，要咖啡喝。进入目的地白昼状态，绝对不能再睡。`,
        start: flightSleepEnd,
        end: arrTime
    });

    // Arrival Day: Stay awake until local sleep time
    // Local bedtime:
    const localBedtime = dayjs.tz(arrTime.format("YYYY-MM-DD") + " " + destSleepStart, arrivalTz);
    
    calculatedEvents.push({
        dayIndex: 1,
        type: "seek",
        title: "【暴露光】抵达目的地并进行日光沐浴",
        description: `飞机着陆目的地，当地时间 ${arrTime.format("HH:mm")}。多在户外活动接触自然日光，严禁回酒店立刻睡觉。`,
        start: arrTime,
        end: localBedtime.subtract(2, 'hour')
    });

    // First Night Melatonin
    if (useMelatonin) {
        const firstNightMel = localBedtime.subtract(1, 'hour');
        calculatedEvents.push({
            dayIndex: 1,
            type: "melatonin",
            title: "【吃药】首夜服用褪黑素 (1.0 - 2.0mg)",
            description: `当地时间 ${firstNightMel.tz(arrivalTz).format("HH:mm")}。服用 1.0 - 2.0mg 褪黑素，为首夜入睡做准备。`,
            start: firstNightMel,
            end: firstNightMel.add(15, 'minute')
        });
    }

    // First Night Sleep
    let firstNightSleepEnd = dayjs.tz(arrTime.format("YYYY-MM-DD") + " " + destSleepEnd, arrivalTz);
    if (firstNightSleepEnd.isBefore(localBedtime)) {
        firstNightSleepEnd = firstNightSleepEnd.add(1, 'day');
    }
    calculatedEvents.push({
        dayIndex: 1,
        type: "sleep",
        title: "【睡眠】目的地首夜睡眠",
        description: `当地时间 ${localBedtime.format("HH:mm")}。去睡觉，恭喜完成时差重置，进入目的地健康的第一个晚上。`,
        start: localBedtime,
        end: firstNightSleepEnd
    });

    // 3. Render Results
    renderSummary(tzDiff, totalShiftNeeded, normalTminStr);
    renderGanttBars();
    renderTimelineFlow();
    
    // Toggle UI display
    document.getElementById("placeholder-section").classList.add("hidden");
    document.getElementById("summary-section").classList.remove("hidden");
    document.getElementById("visual-section").classList.remove("hidden");
    document.getElementById("list-section").classList.remove("hidden");
    
    // Enable export button
    document.getElementById("btn-export").removeAttribute("disabled");
}

// Format summary cards
function renderSummary(tzDiff, totalShift, tminStr) {
    const diffText = `${Math.abs(tzDiff)} 小时`;
    const dirText = tzDiff > 0 ? "向东 (前移)" : "向西 (后移)";
    const prepText = `提前 ${currentPrepDays} 天开始`;
    
    document.getElementById("val-tz-diff").textContent = diffText;
    document.getElementById("val-direction").textContent = dirText;
    document.getElementById("val-prep-days").textContent = prepText;
    document.getElementById("val-tmin").textContent = tminStr;
}

// Render Gantt bars chart
function renderGanttBars() {
    const container = document.getElementById("gantt-bars");
    container.innerHTML = "";

    // 1. Render Ticks Header Row
    const headerRow = document.createElement("div");
    headerRow.className = "gantt-header-row";

    const headerLabel = document.createElement("div");
    headerLabel.className = "gantt-row-label";
    headerLabel.textContent = "时间 (小时)";
    headerRow.appendChild(headerLabel);

    const ticksContainer = document.createElement("div");
    ticksContainer.className = "gantt-time-ticks";
    ticksContainer.innerHTML = `
        <span style="left: 0%;">00:00</span>
        <span style="left: 16.66%;">04:00</span>
        <span style="left: 33.33%;">08:00</span>
        <span style="left: 50.0%;">12:00</span>
        <span style="left: 66.66%;">16:00</span>
        <span style="left: 83.33%;">20:00</span>
        <span style="left: 100%; transform: translateX(-100%);">24:00</span>
    `;
    headerRow.appendChild(ticksContainer);
    container.appendChild(headerRow);

    // 2. Define Day Rows List
    const daysList = [];
    const deptTimeInput = document.getElementById("dept-datetime").value;
    const deptTime = dayjs.tz(deptTimeInput, departureTz);
    const startPrepDate = deptTime.subtract(currentPrepDays, 'day').startOf('day');

    // Prep days
    for (let k = -currentPrepDays; k < 0; k++) {
        const currentDay = startPrepDate.add(k + currentPrepDays, 'day');
        daysList.push({
            dayIndex: k,
            label: `预备第 ${Math.abs(k)} 天`,
            tz: departureTz,
            dayStart: currentDay,
            dayEnd: currentDay.add(1, 'day'),
            events: []
        });
    }

    // Departure day
    const deptDayStart = deptTime.startOf('day');
    daysList.push({
        dayIndex: 0,
        label: "出发日",
        tz: departureTz,
        dayStart: deptDayStart,
        dayEnd: deptDayStart.add(1, 'day'),
        events: []
    });

    // Arrival day
    const arrTimeInput = document.getElementById("arr-datetime").value;
    const arrTime = dayjs.tz(arrTimeInput, arrivalTz);
    const arrDayStart = arrTime.startOf('day');
    daysList.push({
        dayIndex: 1,
        label: "抵达日",
        tz: arrivalTz,
        dayStart: arrDayStart,
        dayEnd: arrDayStart.add(1, 'day'),
        events: []
    });

    // 3. Map events to day rows using absolute time overlap
    calculatedEvents.forEach(evt => {
        const isPoint = (evt.type === "melatonin" || evt.type === "caffeine");

        daysList.forEach(day => {
            const tz = day.tz;
            const dayStartAbs = day.dayStart;
            const dayEndAbs = day.dayEnd;

            if (isPoint) {
                if ((evt.start.isAfter(dayStartAbs) || evt.start.isSame(dayStartAbs)) && evt.start.isBefore(dayEndAbs)) {
                    const eventTimeTz = evt.start.tz(tz);
                    const startH = eventTimeTz.hour() + eventTimeTz.minute() / 60;
                    day.events.push({
                        evt: evt,
                        startH: startH,
                        endH: startH + 0.1
                    });
                }
            } else {
                const overlapStart = evt.start.isBefore(dayStartAbs) ? dayStartAbs : evt.start;
                const overlapEnd = evt.end.isAfter(dayEndAbs) ? dayEndAbs : evt.end;

                if (overlapStart.isBefore(overlapEnd)) {
                    const startTz = overlapStart.tz(tz);
                    const endTz = overlapEnd.tz(tz);

                    let startH = startTz.hour() + startTz.minute() / 60;
                    let endH = endTz.hour() + endTz.minute() / 60;

                    if (overlapEnd.isSame(dayEndAbs) || endTz.isAfter(dayEndAbs) || (endTz.hour() === 0 && endTz.minute() === 0)) {
                        endH = 24.0;
                    }
                    if (overlapStart.isSame(dayStartAbs)) {
                        startH = 0.0;
                    }

                    day.events.push({
                        evt: evt,
                        startH: startH,
                        endH: endH
                    });
                }
            }
        });
    });

    // 4. Render Row Elements with lanes
    daysList.forEach(day => {
        const rowContainer = document.createElement("div");
        rowContainer.className = "gantt-row-container";

        const label = document.createElement("div");
        label.className = "gantt-row-label";
        label.textContent = day.label;
        rowContainer.appendChild(label);

        const row = document.createElement("div");
        row.className = "gantt-row";

        // Add 24 hour overlay lines
        const overlay = document.createElement("div");
        overlay.className = "gantt-grid-overlay";
        for (let i = 0; i < 24; i++) {
            const line = document.createElement("div");
            line.className = "gantt-grid-line";
            overlay.appendChild(line);
        }
        row.appendChild(overlay);

        // Group events by lane: sleep, flight, light, pill
        const lanes = {
            sleep: [],
            flight: [],
            light: [],
            pill: []
        };

        day.events.forEach(blockData => {
            const type = blockData.evt.type;
            if (type === "sleep") {
                lanes.sleep.push(blockData);
            } else if (type === "flight") {
                lanes.flight.push(blockData);
            } else if (type === "seek" || type === "avoid") {
                lanes.light.push(blockData);
            } else if (type === "melatonin" || type === "caffeine") {
                lanes.pill.push(blockData);
            }
        });

        // Render each lane if it has events
        Object.entries(lanes).forEach(([laneType, events]) => {
            if (events.length === 0) return;

            const lane = document.createElement("div");
            lane.className = `gantt-lane ${laneType}-lane`;

            events.forEach(blockData => {
                const { evt, startH, endH } = blockData;
                const tz = day.tz;
                
                let leftPercent = (startH / 24) * 100;
                let widthPercent = ((endH - startH) / 24) * 100;

                if (evt.type === "melatonin" || evt.type === "caffeine") {
                    const marker = document.createElement("div");
                    marker.className = `gantt-marker ${evt.type}`;
                    marker.style.left = `${leftPercent}%`;
                    marker.title = `${evt.title} (${evt.start.tz(tz).format("HH:mm")})`;
                    lane.appendChild(marker);
                } else {
                    const block = document.createElement("div");
                    block.className = `gantt-block ${evt.type}`;
                    block.style.left = `${leftPercent}%`;
                    block.style.width = `${widthPercent}%`;
                    block.title = `${evt.title} (${evt.start.tz(tz).format("HH:mm")} - ${evt.end.tz(tz).format("HH:mm")})`;
                    lane.appendChild(block);
                }
            });

            row.appendChild(lane);
        });

        rowContainer.appendChild(row);
        container.appendChild(rowContainer);
    });
}

// Render vertical detailed timeline flow
function renderTimelineFlow() {
    const container = document.getElementById("vertical-timeline");
    container.innerHTML = "";

    let lastDateHeader = "";

    calculatedEvents.sort((a,b) => a.start.valueOf() - b.start.valueOf()).forEach(evt => {
        // Date heading
        const tz = evt.dayIndex > 0 ? arrivalTz : departureTz;
        const dateHeaderStr = evt.start.tz(tz).format("YYYY年MM月DD日");
        
        if (dateHeaderStr !== lastDateHeader) {
            lastDateHeader = dateHeaderStr;
            const header = document.createElement("div");
            header.className = "timeline-day-header";
            
            let label = "";
            if (evt.dayIndex < 0) label = `预适应第 ${Math.abs(evt.dayIndex)} 天`;
            else if (evt.dayIndex === 0) label = "航班出发日";
            else label = "抵达目的地";
            
            header.innerHTML = `<span>${dateHeaderStr}</span> <span style="font-size: 0.8rem; opacity: 0.6; font-weight: normal;">(${label})</span>`;
            container.appendChild(header);
        }

        // Timeline card
        const item = document.createElement("div");
        item.className = `timeline-item ${evt.type}`;
        
        const node = document.createElement("div");
        node.className = "timeline-node";
        item.appendChild(node);

        // Calculate time labels in both zones
        const startOrigin = evt.start.tz(departureTz).format("HH:mm");
        const endOrigin = evt.end.tz(departureTz).format("HH:mm");
        
        const startDest = evt.start.tz(arrivalTz).format("HH:mm");
        const endDest = evt.end.tz(arrivalTz).format("HH:mm");

        const timeRow = document.createElement("div");
        timeRow.className = "timeline-time-row";
        
        const isDepZone = evt.dayIndex <= 0;
        
        let originTimeStr = evt.type === "melatonin" ? `${startOrigin}` : `${startOrigin} - ${endOrigin}`;
        let destTimeStr = evt.type === "melatonin" ? `${startDest}` : `${startDest} - ${endDest}`;

        const deptTzShort = departureTz.split("/").pop().replace(/_/g, " ");
        const arrTzShort = arrivalTz.split("/").pop().replace(/_/g, " ");

        timeRow.innerHTML = `
            <span class="${isDepZone ? 'active-tz' : ''}">出发地 (${deptTzShort}): ${originTimeStr}</span>
            <span class="${!isDepZone ? 'active-tz' : ''}">目的地 (${arrTzShort}): ${destTimeStr}</span>
        `;
        item.appendChild(timeRow);

        // Title with icon
        const title = document.createElement("div");
        title.className = "timeline-title";
        
        let iconName = "clock";
        if (evt.type === "sleep") iconName = "moon";
        else if (evt.type === "seek") iconName = "sun";
        else if (evt.type === "avoid") iconName = "eye-off";
        else if (evt.type === "flight") iconName = "plane";
        else if (evt.type === "melatonin") iconName = "pill";
        else if (evt.type === "caffeine") iconName = "coffee";

        title.innerHTML = `<i data-lucide="${iconName}"></i> ${evt.title}`;
        item.appendChild(title);

        // Description
        const desc = document.createElement("div");
        desc.className = "timeline-desc";
        desc.textContent = evt.description;
        item.appendChild(desc);

        container.appendChild(item);
    });

    // Re-trigger lucide icons rendering
    lucide.createIcons();
}

// Time calculation helper: adds positive/negative hours to a "HH:mm" string
function addHoursToTimeStr(timeStr, hoursOffset) {
    const [h, m] = timeStr.split(":").map(Number);
    let totalMinutes = h * 60 + m + Math.round(hoursOffset * 60);
    totalMinutes = (totalMinutes + 1440 * 10) % 1440; // positive wrap
    
    const outH = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
    const outM = String(totalMinutes % 60).padStart(2, '0');
    return `${outH}:${outM}`;
}

// Date helper: combines a Day.js date object with a "HH:mm" time string in a target timezone
function combineDateAndTime(dateObj, timeStr, tzName) {
    const dateStr = dateObj.format("YYYY-MM-DD");
    return dayjs.tz(`${dateStr} ${timeStr}`, "YYYY-MM-DD HH:mm", tzName);
}

// Dynamic iCalendar (.ics) generation & download
function exportToIcs() {
    if (calculatedEvents.length === 0) return;

    let icsContent = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//JetLag Ninja//Circadian Planner//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH"
    ];

    const stamp = dayjs().utc().format("YYYYMMDDTHHmmss[Z]");

    calculatedEvents.forEach((evt, idx) => {
        // ICS timestamps must be strictly in UTC YYYYMMDDTHHMMSSZ format
        const startUtc = evt.start.utc().format("YYYYMMDDTHHmmss[Z]");
        const endUtc = evt.end.utc().format("YYYYMMDDTHHmmss[Z]");
        const uid = `jetlag-ninja-${idx}-${evt.start.valueOf()}`;
        
        icsContent.push("BEGIN:VEVENT");
        icsContent.push(`UID:${uid}`);
        icsContent.push(`DTSTAMP:${stamp}`);
        icsContent.push(`DTSTART:${startUtc}`);
        icsContent.push(`DTEND:${endUtc}`);
        icsContent.push(`SUMMARY:${evt.title}`);
        
        // Clean description for ICS format (no newlines without encoding, simple text)
        const cleanDesc = evt.description.replace(/\n/g, "\\n");
        icsContent.push(`DESCRIPTION:${cleanDesc}`);
        
        // 10 minute reminder alarm
        icsContent.push("BEGIN:VALARM");
        icsContent.push("TRIGGER:-PT10M");
        icsContent.push("ACTION:DISPLAY");
        icsContent.push(`DESCRIPTION:【提醒】${evt.title}将在10分钟后开始`);
        icsContent.push("END:VALARM");
        
        icsContent.push("END:VEVENT");
    });

    icsContent.push("END:VCALENDAR");

    const icsString = icsContent.join("\r\n");

    // Download trigger
    const blob = new Blob([icsString], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement("a");
    link.href = window.URL.createObjectURL(blob);
    link.setAttribute("download", "jet_lag_pre_adaptation_plan.ics");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
