var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/auth.ts
async function getSupabaseUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token.length > 4096) return null;
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.SUPABASE_ANON_KEY
    }
  });
  if (!response.ok) return null;
  const value = await response.json();
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) return null;
  return {
    id: value.id,
    email: typeof value.email === "string" ? value.email : void 0
  };
}
__name(getSupabaseUser, "getSupabaseUser");
function isAdminUser(user, env) {
  if (!user?.email) return false;
  const allowed = env.ADMIN_EMAILS.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(user.email.toLowerCase());
}
__name(isAdminUser, "isAdminUser");
function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
__name(isRecord, "isRecord");

// src/booking-rules.ts
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var TIME_RE = /^(?:0\d|1\d|2[0-3]):(?:00|30)$/;
var STAFFS = /* @__PURE__ */ new Set(["\u9EBB\u751F\u5DDD", "\u5CA1\u91CE", "\u5800\u6C5F", "\u677E\u7530", "\u5C71\u53E3"]);
var WEEKLY_OFF = { "\u9EBB\u751F\u5DDD": 1, "\u677E\u7530": 2, "\u5800\u6C5F": 4, "\u5C71\u53E3": 5, "\u5CA1\u91CE": 6 };
var WORK_HOURS = {
  "\u9EBB\u751F\u5DDD": { start: "12:00", end: "21:00" },
  "\u677E\u7530": { start: "11:00", end: "21:00" },
  "\u5C71\u53E3": { start: "09:00", end: "19:00" },
  "\u5CA1\u91CE": { start: "09:00", end: "19:00" },
  "\u5800\u6C5F": { start: "09:00", end: "19:00" }
};
var OPEN_OVERRIDE_REASON = "__OPEN_OVERRIDE__";
var MAX_DAYS_AHEAD = 8;
var D1_MAX_BOUND_PARAMS = 100;
function isValidIsoDate(value) {
  if (!DATE_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
__name(isValidIsoDate, "isValidIsoDate");
function tokyoDateString(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
__name(tokyoDateString, "tokyoDateString");
function tokyoTimeString(date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}
__name(tokyoTimeString, "tokyoTimeString");
function addDays(dateString, days) {
  const date = /* @__PURE__ */ new Date(`${dateString}T00:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return tokyoDateString(date);
}
__name(addDays, "addDays");
function isOccupancyDateAllowed(date, now = /* @__PURE__ */ new Date()) {
  if (!isValidIsoDate(date)) return false;
  const today = tokyoDateString(now);
  return date >= today && date <= addDays(today, MAX_DAYS_AHEAD);
}
__name(isOccupancyDateAllowed, "isOccupancyDateAllowed");
function isValidDuration(start, end) {
  const difference = timeMinutes(end) - timeMinutes(start);
  return [30, 60, 90, 120].includes(difference);
}
__name(isValidDuration, "isValidDuration");
function timeMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}
__name(timeMinutes, "timeMinutes");
function bookingSlots(start, end) {
  const slots = [];
  for (let minutes = timeMinutes(start); minutes < timeMinutes(end); minutes += 30) {
    slots.push(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
  }
  return slots;
}
__name(bookingSlots, "bookingSlots");
function weekdayUtcFromIsoDate(date) {
  return (/* @__PURE__ */ new Date(`${date}T00:00:00Z`)).getUTCDay();
}
__name(weekdayUtcFromIsoDate, "weekdayUtcFromIsoDate");
function isNormallyOpen(date, time, staff) {
  const hours = WORK_HOURS[staff];
  if (!hours) return false;
  return weekdayUtcFromIsoDate(date) !== WEEKLY_OFF[staff] && time >= hours.start && time < hours.end;
}
__name(isNormallyOpen, "isNormallyOpen");
function isOutsideStaffHours(staff, time) {
  const hours = WORK_HOURS[staff];
  if (!hours || !time) return false;
  return time < hours.start || time >= hours.end;
}
__name(isOutsideStaffHours, "isOutsideStaffHours");
function generateBookingId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 9).toUpperCase();
}
__name(generateBookingId, "generateBookingId");
function chunk(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}
__name(chunk, "chunk");

// src/booking-write.ts
async function insertBookingIfAvailable(database, input, audit) {
  const id = input.id || generateBookingId();
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const booking = await database.prepare(`
    INSERT INTO bookings (
      id, created_at, date, start_time, end_time, staff, patient_name, phone,
      symptoms, fee, status, user_id, admin_memo, is_new_patient
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '\u4E88\u7D04\u6E08\u307F', ?, ?, 0
    WHERE NOT EXISTS (
      SELECT 1 FROM bookings
      WHERE date = ? AND staff = ?
        AND COALESCE(status, '') <> '\u30AD\u30E3\u30F3\u30BB\u30EB'
        AND start_time < ? AND end_time > ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM blocks
      WHERE date = ? AND staff = ? AND reason <> ?
        AND time >= ? AND time < ?
    )
    RETURNING id, date, start_time, end_time, staff, patient_name, phone, symptoms, user_id, status
  `).bind(
    id,
    createdAt,
    input.date,
    input.start_time,
    input.end_time,
    input.staff,
    input.patient_name,
    input.phone,
    input.symptoms,
    input.fee,
    input.user_id ?? null,
    input.admin_memo ?? null,
    input.date,
    input.staff,
    input.end_time,
    input.start_time,
    input.date,
    input.staff,
    OPEN_OVERRIDE_REASON,
    input.start_time,
    input.end_time
  ).first();
  if (!booking) {
    return {
      ok: false,
      code: "BOOKING_CONFLICT",
      message: "\u9078\u629E\u3057\u305F\u6642\u9593\u5E2F\u306F\u3059\u3067\u306B\u4E88\u7D04\u6E08\u307F\u3001\u307E\u305F\u306F\u4E88\u7D04\u4E0D\u53EF\u3067\u3059",
      status: 409
    };
  }
  const auditFailed = !await insertAuditLog(database, {
    bookingId: booking.id,
    action: audit.action,
    details: audit.details,
    userEmail: audit.userEmail,
    createdAt
  });
  return { ok: true, booking, auditFailed };
}
__name(insertBookingIfAvailable, "insertBookingIfAvailable");
async function cancelBookingIfAllowed(database, input, audit) {
  const cancelledAt = (/* @__PURE__ */ new Date()).toISOString();
  const result = await database.prepare(`
    UPDATE bookings SET status = '\u30AD\u30E3\u30F3\u30BB\u30EB'
    WHERE id = ? AND user_id = ? AND date > ? AND COALESCE(status, '') <> '\u30AD\u30E3\u30F3\u30BB\u30EB'
    RETURNING id, date, start_time, end_time, staff
  `).bind(input.bookingId, input.userId, input.minDateExclusive).first();
  if (!result) {
    return {
      ok: false,
      code: "CANNOT_CANCEL",
      message: "\u5F53\u65E5\u4E88\u7D04\u306F\u753B\u9762\u304B\u3089\u30AD\u30E3\u30F3\u30BB\u30EB\u3067\u304D\u306A\u3044\u304B\u3001\u4E88\u7D04\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093",
      status: 409
    };
  }
  const auditFailed = !await insertAuditLog(database, {
    bookingId: result.id,
    action: audit.action,
    details: `${result.date} ${result.start_time}\u301C${result.end_time} ${result.staff} \u306E\u4E88\u7D04\u3092\u30AD\u30E3\u30F3\u30BB\u30EB`,
    userEmail: audit.userEmail,
    createdAt: cancelledAt
  });
  return { ok: true, auditFailed };
}
__name(cancelBookingIfAllowed, "cancelBookingIfAllowed");
async function insertAuditLog(database, input) {
  try {
    await database.prepare(`
      INSERT INTO audit_logs (booking_id, action, details, user_email, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(input.bookingId, input.action, input.details, input.userEmail, input.createdAt).run();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "audit log failed";
    console.error(JSON.stringify({
      message: "audit log insert failed after successful booking write",
      bookingId: input.bookingId,
      action: input.action,
      error: message
    }));
    return false;
  }
}
__name(insertAuditLog, "insertAuditLog");

// src/admin-api.ts
var MAX_BODY_BYTES = 256e3;
var MAX_ADMIN_BOOKINGS = 50;
var MAX_BULK_SLOTS = 1e3;
var BLOCK_INSERT_COLS = 5;
var BLOCK_DELETE_PARAMS = 3;
var ROWS_PER_INSERT = Math.floor(D1_MAX_BOUND_PARAMS / BLOCK_INSERT_COLS);
var SLOTS_PER_DELETE = Math.floor(D1_MAX_BOUND_PARAMS / BLOCK_DELETE_PARAMS);
async function handleAdminApi(request, env, path) {
  if (request.method !== "POST") return apiError("method not allowed", "METHOD_NOT_ALLOWED", 405);
  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (contentLength > MAX_BODY_BYTES) return apiError("request is too large", "PAYLOAD_TOO_LARGE", 413);
  const user = await getSupabaseUser(request, env);
  if (!isAdminUser(user, env)) return apiError("admin required", "ADMIN_REQUIRED", 401);
  let input;
  try {
    input = await request.json();
  } catch {
    return apiError("invalid json", "INVALID_JSON", 400);
  }
  try {
    if (path === "/api/admin/bookings") return await createAdminBookings(env.DB, input, user?.email || null);
    if (path === "/api/admin/blocks/bulk") return await mutateBlocks(env.DB, input);
    return apiError("not found", "NOT_FOUND", 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "admin operation failed";
    console.error(JSON.stringify({ message: "admin api failed", path, error: message }));
    return apiError(message, "ADMIN_API_FAILED", 500);
  }
}
__name(handleAdminApi, "handleAdminApi");
async function createAdminBookings(database, value, userEmail) {
  const bookings = parseAdminBookings(value);
  if (!bookings) return apiError("\u4E88\u7D04\u5185\u5BB9\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093", "INVALID_BOOKING", 400);
  const created = [];
  const conflicts = [];
  for (const booking of bookings) {
    const hoursError = await outsideHoursError(database, booking);
    if (hoursError) return apiError(hoursError, "OUTSIDE_BUSINESS_HOURS", 409);
    if (await inHoursRealBlock(database, booking)) {
      conflicts.push({
        date: booking.date,
        start_time: booking.start_time,
        end_time: booking.end_time,
        staff: booking.staff
      });
      continue;
    }
    await clearOutsideHourBlocks(database, booking);
    const saved = await insertBookingIfAvailable(database, {
      ...booking,
      id: generateBookingId(),
      user_id: null
    }, {
      action: bookings.length > 1 ? "\u7E70\u308A\u8FD4\u3057\u4E88\u7D04\u4F5C\u6210" : "\u4E88\u7D04\u4F5C\u6210",
      details: `${booking.patient_name}\u69D8 ${booking.staff} ${booking.date} ${booking.start_time}\u301C${booking.end_time} \xA5${booking.fee.toLocaleString("ja-JP")}`,
      userEmail
    });
    if (!saved.ok) {
      if (saved.code === "BOOKING_CONFLICT") {
        conflicts.push({
          date: booking.date,
          start_time: booking.start_time,
          end_time: booking.end_time,
          staff: booking.staff
        });
        continue;
      }
      return apiError(saved.message, saved.code, saved.status);
    }
    created.push(saved.booking);
  }
  if (!created.length) {
    return apiError("\u9078\u629E\u3057\u305F\u6642\u9593\u5E2F\u306F\u3059\u3067\u306B\u4E88\u7D04\u6E08\u307F\u3001\u307E\u305F\u306F\u4E88\u7D04\u4E0D\u53EF\u3067\u3059", "BOOKING_CONFLICT", 409);
  }
  return apiJson({ created, conflicts, count: created.length }, created.length === bookings.length ? 201 : 200);
}
__name(createAdminBookings, "createAdminBookings");
async function outsideHoursError(database, booking) {
  const overrideResult = await database.prepare(`
    SELECT time FROM blocks
    WHERE date = ? AND staff = ? AND reason = ?
      AND time >= ? AND time < ?
  `).bind(booking.date, booking.staff, OPEN_OVERRIDE_REASON, booking.start_time, booking.end_time).all();
  const overrides = new Set(overrideResult.results.map((row) => row.time));
  for (const slot of bookingSlots(booking.start_time, booking.end_time)) {
    if (isOutsideStaffHours(booking.staff, slot)) continue;
    if (!isNormallyOpen(booking.date, slot, booking.staff) && !overrides.has(slot)) {
      return "\u9078\u629E\u3057\u305F\u6642\u9593\u5E2F\u306F\u8A3A\u7642\u6642\u9593\u5916\u307E\u305F\u306F\u5B9A\u4F11\u65E5\u3067\u3059";
    }
  }
  return null;
}
__name(outsideHoursError, "outsideHoursError");

async function inHoursRealBlock(database, booking) {
  const slots = bookingSlots(booking.start_time, booking.end_time).filter((slot) => !isOutsideStaffHours(booking.staff, slot));
  if (!slots.length) return false;
  const placeholders = slots.map(() => "?").join(", ");
  const row = await database.prepare(`SELECT time FROM blocks WHERE date = ? AND staff = ? AND reason <> ? AND time IN (${placeholders}) LIMIT 1`).bind(booking.date, booking.staff, OPEN_OVERRIDE_REASON, ...slots).first();
  return Boolean(row);
}
__name(inHoursRealBlock, "inHoursRealBlock");
async function clearOutsideHourBlocks(database, booking) {
  const slots = bookingSlots(booking.start_time, booking.end_time).filter((slot) => isOutsideStaffHours(booking.staff, slot));
  if (!slots.length) return;
  const placeholders = slots.map(() => "?").join(", ");
  await database.prepare(`DELETE FROM blocks WHERE date = ? AND staff = ? AND time IN (${placeholders})`).bind(booking.date, booking.staff, ...slots).run();
}
__name(clearOutsideHourBlocks, "clearOutsideHourBlocks");
async function mutateBlocks(database, value) {
  const parsed = parseBlockMutation(value);
  if (!parsed) return apiError("\u30D6\u30ED\u30C3\u30AF\u5185\u5BB9\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093", "INVALID_BLOCKS", 400);
  const { action, slots } = parsed;
  const createdAt = `${(/* @__PURE__ */ new Date()).toISOString()}#${crypto.randomUUID()}`;
  if (action === "block") {
    const conflict = await findBookingConflicts(database, slots);
    if (conflict) return apiError(conflict, "BOOKING_CONFLICT", 409);
  }
  const deleteStmts = action === "block" ? deleteStatements(database, slots, OPEN_OVERRIDE_REASON) : deleteStatements(database, slots);
  const insertStmts = action === "unblock" ? [] : insertBlockStatements(database, slots, createdAt);
  if (!deleteStmts.length && !insertStmts.length) {
    return apiError("\u30D6\u30ED\u30C3\u30AF\u5185\u5BB9\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093", "INVALID_BLOCKS", 400);
  }
  const results = await database.batch([...deleteStmts, ...insertStmts]);
  if (insertStmts.length) {
    const inserted = countChanges(results.slice(deleteStmts.length));
    if (inserted !== slots.length) {
      await database.prepare(`DELETE FROM blocks WHERE created_at = ?`).bind(createdAt).run();
      return apiError("\u30D6\u30ED\u30C3\u30AF\u306E\u4E00\u62EC\u51E6\u7406\u306B\u5931\u6557\u3057\u307E\u3057\u305F", "BLOCK_PARTIAL_FAILURE", 409);
    }
  }
  return apiJson({ ok: true, count: slots.length, action });
}
__name(mutateBlocks, "mutateBlocks");
function deleteStatements(database, slots, reason) {
  const perStatement = reason ? Math.floor((D1_MAX_BOUND_PARAMS - 1) / BLOCK_DELETE_PARAMS) : SLOTS_PER_DELETE;
  return chunk(slots, perStatement).map((group) => {
    const where = group.map(() => "(date = ? AND time = ? AND staff = ?)").join(" OR ");
    const sql = reason ? `DELETE FROM blocks WHERE (${where}) AND reason = ?` : `DELETE FROM blocks WHERE ${where}`;
    const binds = group.flatMap((slot) => [slot.date, slot.time, slot.staff]);
    if (reason) binds.push(reason);
    return database.prepare(sql).bind(...binds);
  });
}
__name(deleteStatements, "deleteStatements");
function insertBlockStatements(database, slots, createdAt) {
  return chunk(slots, ROWS_PER_INSERT).map((group) => {
    const values = group.map(() => "(?, ?, ?, ?, ?)").join(", ");
    const binds = group.flatMap((slot) => [createdAt, slot.date, slot.time, slot.staff, slot.reason]);
    return database.prepare(
      `INSERT INTO blocks (created_at, date, time, staff, reason) VALUES ${values}`
    ).bind(...binds);
  });
}
__name(insertBlockStatements, "insertBlockStatements");
function countChanges(results) {
  return results.reduce((sum, result) => sum + (result.meta.changes || 0), 0);
}
__name(countChanges, "countChanges");
async function findBookingConflicts(database, slots) {
  const dates = [...new Set(slots.map((slot) => slot.date))];
  const staffs = [...new Set(slots.map((slot) => slot.staff))];
  if (!dates.length || !staffs.length) return "\u30D6\u30ED\u30C3\u30AF\u5185\u5BB9\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093";
  const wanted = new Set(slots.map((slot) => `${slot.date}|${slot.staff}|${slot.time}`));
  const conflicts = [];
  const dateChunkSize = Math.max(1, D1_MAX_BOUND_PARAMS - staffs.length);
  for (const dateGroup of chunk(dates, dateChunkSize)) {
    const bookings = await database.prepare(`
      SELECT date, start_time, end_time, staff, patient_name
      FROM bookings
      WHERE date IN (${dateGroup.map(() => "?").join(", ")})
        AND staff IN (${staffs.map(() => "?").join(", ")})
        AND COALESCE(status, '') <> '\u30AD\u30E3\u30F3\u30BB\u30EB'
    `).bind(...dateGroup, ...staffs).all();
    for (const booking of bookings.results) {
      for (const time of bookingSlots(booking.start_time, booking.end_time)) {
        const key = `${booking.date}|${booking.staff}|${time}`;
        if (wanted.has(key)) {
          conflicts.push(`${booking.date} ${time} ${booking.staff}\uFF08${booking.patient_name}\u69D8\uFF09`);
        }
      }
    }
  }
  if (!conflicts.length) return null;
  return `\u4EE5\u4E0B\u306E\u6642\u9593\u5E2F\u306B\u4E88\u7D04\u304C\u5165\u3063\u3066\u3044\u308B\u305F\u3081\u3001\u30D6\u30ED\u30C3\u30AF\u3067\u304D\u307E\u305B\u3093\uFF1A

${conflicts.join("\n")}`;
}
__name(findBookingConflicts, "findBookingConflicts");
function parseAdminBookings(value) {
  if (!isRecord2(value) || !Array.isArray(value.bookings) || !value.bookings.length || value.bookings.length > MAX_ADMIN_BOOKINGS) {
    return null;
  }
  const bookings = [];
  for (const item of value.bookings) {
    const booking = parseAdminBooking(item);
    if (!booking) return null;
    bookings.push(booking);
  }
  return bookings;
}
__name(parseAdminBookings, "parseAdminBookings");
function parseAdminBooking(value) {
  if (!isRecord2(value)) return null;
  const booking = {
    date: stringValue(value.date),
    start_time: stringValue(value.start_time),
    end_time: stringValue(value.end_time),
    staff: stringValue(value.staff),
    patient_name: stringValue(value.patient_name).trim(),
    phone: stringValue(value.phone).trim(),
    symptoms: stringValue(value.symptoms).trim(),
    fee: Number(value.fee || 0),
    admin_memo: stringValue(value.admin_memo).trim()
  };
  if (!isValidIsoDate(booking.date) || !TIME_RE.test(booking.start_time) || !TIME_RE.test(booking.end_time)) return null;
  if (!isValidDuration(booking.start_time, booking.end_time)) return null;
  if (!STAFFS.has(booking.staff) || !booking.patient_name || booking.patient_name.length > 50) return null;
  if (booking.phone.length > 20 || booking.symptoms.length > 500 || booking.admin_memo.length > 2e3) return null;
  if (!Number.isInteger(booking.fee) || booking.fee < 0 || booking.fee > 1e7) return null;
  return booking;
}
__name(parseAdminBooking, "parseAdminBooking");
function parseBlockMutation(value) {
  if (!isRecord2(value)) return null;
  const action = value.action;
  if (action !== "block" && action !== "unblock" && action !== "open_override") return null;
  if (!Array.isArray(value.slots) || !value.slots.length || value.slots.length > MAX_BULK_SLOTS) return null;
  const slots = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of value.slots) {
    if (!isRecord2(item)) return null;
    const slot = {
      date: stringValue(item.date),
      time: stringValue(item.time),
      staff: stringValue(item.staff),
      reason: action === "open_override" ? OPEN_OVERRIDE_REASON : stringValue(item.reason).trim() || "BLOCK"
    };
    if (!isValidIsoDate(slot.date) || !TIME_RE.test(slot.time) || !STAFFS.has(slot.staff)) return null;
    if (slot.reason.length > 200) return null;
    const key = `${slot.date}|${slot.staff}|${slot.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    slots.push(slot);
  }
  return slots.length ? { action, slots } : null;
}
__name(parseBlockMutation, "parseBlockMutation");
function stringValue(value) {
  return typeof value === "string" ? value : "";
}
__name(stringValue, "stringValue");
function isRecord2(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
__name(isRecord2, "isRecord");
function apiJson(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
__name(apiJson, "apiJson");
function apiError(message, code, status) {
  return apiJson({ error: { message, code, details: null } }, status);
}
__name(apiError, "apiError");

// src/db-api.ts
var TABLE_COLUMNS = {
  bookings: [
    "id",
    "created_at",
    "date",
    "start_time",
    "end_time",
    "staff",
    "patient_name",
    "email",
    "phone",
    "symptoms",
    "fee",
    "status",
    "user_id",
    "admin_memo",
    "payment_method",
    "payment_date",
    "payment_breakdown",
    "is_new_patient"
  ],
  blocks: ["id", "created_at", "date", "time", "staff", "reason"],
  staffs: ["name", "fee"],
  expenses: [
    "id",
    "date",
    "category",
    "item_name",
    "amount",
    "staff",
    "memo",
    "created_by",
    "created_at",
    "deleted_at",
    "flow",
    "inflow_method"
  ],
  advance_tab_payments: [
    "id",
    "payment_date",
    "patient_name",
    "booking_id",
    "staff",
    "amount",
    "payment_method",
    "payment_type",
    "memo",
    "created_by",
    "created_at",
    "deleted_at"
  ],
  audit_logs: ["id", "booking_id", "action", "details", "user_email", "created_at"],
  expense_audit_logs: ["id", "expense_id", "action", "details", "user_email", "created_at"]
};
var JSON_COLUMNS = /* @__PURE__ */ new Set(["bookings.payment_breakdown"]);
var BOOLEAN_COLUMNS = /* @__PURE__ */ new Set(["bookings.is_new_patient"]);
var MAX_BODY_BYTES2 = 256e3;
var MAX_RESULT_ROWS = 2e3;
async function handleDatabaseApi(request, env) {
  if (request.method !== "POST") return apiError2("method not allowed", "METHOD_NOT_ALLOWED", 405);
  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (contentLength > MAX_BODY_BYTES2) return apiError2("request is too large", "PAYLOAD_TOO_LARGE", 413);
  const user = await getSupabaseUser(request, env);
  let input;
  try {
    input = await request.json();
  } catch {
    return apiError2("invalid json", "INVALID_JSON", 400);
  }
  const parsed = parseDatabaseQuery(input);
  if (!parsed.ok) return apiError2(parsed.message, parsed.code, 400);
  const query = parsed.query;
  const publicStaffRead = query.table === "staffs" && query.operation === "select";
  if (!publicStaffRead && !isAdminUser(user, env)) {
    return apiError2("admin required", "ADMIN_REQUIRED", 401);
  }
  try {
    if (query.operation === "select") return await executeSelect(env.DB, query);
    if (query.operation === "insert" || query.operation === "upsert") {
      return await executeInsert(env.DB, query);
    }
    if (query.operation === "update") return await executeUpdate(env.DB, query);
    return await executeDelete(env.DB, query);
  } catch (error) {
    const message = error instanceof Error ? error.message : "database operation failed";
    console.error(JSON.stringify({ message: "d1 query failed", table: query.table, operation: query.operation, error: message }));
    return apiError2(message, "D1_QUERY_FAILED", 400);
  }
}
__name(handleDatabaseApi, "handleDatabaseApi");
async function executeSelect(database, query) {
  const columns = selectedColumns(query);
  const where = buildWhere(query);
  const ordering = query.order.length ? ` ORDER BY ${query.order.map((item) => `${identifier(query.table, item.column)} ${item.ascending ? "ASC" : "DESC"}`).join(", ")}` : "";
  const requestedLimit = query.range ? query.range.to - query.range.from + 1 : query.limit;
  const limit = Math.min(Math.max(requestedLimit || MAX_RESULT_ROWS, 1), MAX_RESULT_ROWS);
  const offset = query.range ? Math.max(query.range.from, 0) : 0;
  const sql = `SELECT ${columns.sql} FROM ${quoteIdentifier(query.table)}${where.sql}${ordering} LIMIT ? OFFSET ?`;
  const result = await database.prepare(sql).bind(...where.values, limit, offset).all();
  const rows = result.results.map((row) => normalizeOutgoingRow(query.table, row));
  if (query.single || query.maybeSingle) {
    if (rows.length === 1) return apiJson2({ data: rows[0], count: 1 });
    if (query.maybeSingle && rows.length === 0) return apiJson2({ data: null, count: 0 });
    return apiError2("JSON object requested, multiple (or no) rows returned", "PGRST116", 406);
  }
  return apiJson2({ data: rows, count: rows.length, truncated: rows.length === limit });
}
__name(executeSelect, "executeSelect");
async function executeInsert(database, query) {
  const inputRows = Array.isArray(query.payload) ? query.payload : [query.payload];
  if (!inputRows.length || inputRows.length > 500 || inputRows.some((row) => !isRecord3(row))) {
    return apiError2("invalid insert payload", "INVALID_PAYLOAD", 400);
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const prepared = [];
  for (const inputRow of inputRows) {
    const row = withInsertDefaults(query.table, inputRow, now);
    const columns = Object.keys(row);
    validateColumns(query.table, columns);
    if (!columns.length) throw new Error("insert payload is empty");
    const values = columns.map((column) => toDatabaseValue(query.table, column, row[column]));
    let sql = `INSERT INTO ${quoteIdentifier(query.table)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
    if (query.operation === "upsert") {
      const conflict = query.onConflict || primaryKeyFor(query.table);
      identifier(query.table, conflict);
      const updates = columns.filter((column) => column !== conflict);
      sql += updates.length ? ` ON CONFLICT (${quoteIdentifier(conflict)}) DO UPDATE SET ${updates.map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`).join(", ")}` : ` ON CONFLICT (${quoteIdentifier(conflict)}) DO NOTHING`;
    }
    if (query.returning) sql += ` RETURNING ${selectedColumns(query).sql}`;
    prepared.push(database.prepare(sql).bind(...values));
  }
  const results = await database.batch(prepared);
  const rows = results.flatMap((result) => result.results).map((row) => normalizeOutgoingRow(query.table, row));
  return mutationResponse(query, rows, inputRows.length);
}
__name(executeInsert, "executeInsert");
async function executeUpdate(database, query) {
  if (!isRecord3(query.payload)) return apiError2("invalid update payload", "INVALID_PAYLOAD", 400);
  const payload = query.payload;
  if (!query.filters.length && !query.or.length) return apiError2("update filter required", "FILTER_REQUIRED", 400);
  const columns = Object.keys(payload);
  validateColumns(query.table, columns);
  if (!columns.length) return apiError2("update payload is empty", "INVALID_PAYLOAD", 400);
  const values = columns.map((column) => toDatabaseValue(query.table, column, payload[column]));
  const where = buildWhere(query);
  let sql = `UPDATE ${quoteIdentifier(query.table)} SET ${columns.map((column) => `${quoteIdentifier(column)} = ?`).join(", ")}${where.sql}`;
  if (query.returning) sql += ` RETURNING ${selectedColumns(query).sql}`;
  const result = await database.prepare(sql).bind(...values, ...where.values).all();
  return mutationResponse(query, result.results.map((row) => normalizeOutgoingRow(query.table, row)), result.meta.changes || 0);
}
__name(executeUpdate, "executeUpdate");
async function executeDelete(database, query) {
  if (!query.filters.length && !query.or.length) return apiError2("delete filter required", "FILTER_REQUIRED", 400);
  const where = buildWhere(query);
  let sql = `DELETE FROM ${quoteIdentifier(query.table)}${where.sql}`;
  if (query.returning) sql += ` RETURNING ${selectedColumns(query).sql}`;
  const result = await database.prepare(sql).bind(...where.values).all();
  return mutationResponse(query, result.results.map((row) => normalizeOutgoingRow(query.table, row)), result.meta.changes || 0);
}
__name(executeDelete, "executeDelete");
function mutationResponse(query, rows, changes) {
  if (query.single || query.maybeSingle) {
    if (rows.length === 1) return apiJson2({ data: rows[0], count: changes });
    if (query.maybeSingle && rows.length === 0) return apiJson2({ data: null, count: changes });
    return apiError2("JSON object requested, multiple (or no) rows returned", "PGRST116", 406);
  }
  return apiJson2({ data: query.returning ? rows : null, count: changes });
}
__name(mutationResponse, "mutationResponse");
function buildWhere(query) {
  const clauses = [];
  const values = [];
  for (const filter of query.filters) {
    const column = identifier(query.table, filter.column);
    if (filter.operator === "in") {
      if (!Array.isArray(filter.value) || !filter.value.length || filter.value.length > 500) throw new Error("invalid in filter");
      clauses.push(`${column} IN (${filter.value.map(() => "?").join(", ")})`);
      values.push(...filter.value.map((value) => scalarValue(value)));
      continue;
    }
    if (filter.operator === "is" || filter.operator === "not" && filter.innerOperator === "is") {
      if (filter.value !== null) throw new Error("only null is supported for is filters");
      clauses.push(`${column} IS ${filter.operator === "not" ? "NOT " : ""}NULL`);
      continue;
    }
    const operators = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
    const sqlOperator = operators[filter.operator];
    if (!sqlOperator) throw new Error("unsupported filter operator");
    clauses.push(`${column} ${sqlOperator} ?`);
    values.push(scalarValue(filter.value));
  }
  for (const expression of query.or) {
    const parsed = expression.split(",").map((part) => parseOrTerm(query.table, part));
    clauses.push(`(${parsed.map((item) => item.sql).join(" OR ")})`);
    for (const item of parsed) values.push(...item.values);
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "", values };
}
__name(buildWhere, "buildWhere");
function parseOrTerm(table, expression) {
  const first = expression.indexOf(".");
  const second = expression.indexOf(".", first + 1);
  if (first <= 0 || second <= first) throw new Error("invalid or filter");
  const column = identifier(table, expression.slice(0, first));
  const operator = expression.slice(first + 1, second);
  const raw = expression.slice(second + 1);
  if (operator === "is" && raw === "null") return { sql: `${column} IS NULL`, values: [] };
  if (operator === "not.is" && raw === "null") return { sql: `${column} IS NOT NULL`, values: [] };
  if (operator === "eq") return { sql: `${column} = ?`, values: [raw] };
  if (operator === "neq") return { sql: `${column} <> ?`, values: [raw] };
  throw new Error("unsupported or filter");
}
__name(parseOrTerm, "parseOrTerm");
function selectedColumns(query) {
  const all = TABLE_COLUMNS[query.table];
  const requested = !query.columns || query.columns.trim() === "*" ? [...all] : query.columns.split(",").map((column) => column.trim()).filter(Boolean);
  validateColumns(query.table, requested);
  return { sql: requested.map(quoteIdentifier).join(", "), names: requested };
}
__name(selectedColumns, "selectedColumns");
function normalizeOutgoingRow(table, row) {
  const output = { ...row };
  for (const [column, value] of Object.entries(output)) {
    const key = `${table}.${column}`;
    if (JSON_COLUMNS.has(key) && typeof value === "string") output[column] = JSON.parse(value);
    if (BOOLEAN_COLUMNS.has(key) && typeof value === "number") output[column] = Boolean(value);
  }
  return output;
}
__name(normalizeOutgoingRow, "normalizeOutgoingRow");
function withInsertDefaults(table, row, now) {
  const result = { ...row };
  if (TABLE_COLUMNS[table].includes("created_at") && result.created_at === void 0) result.created_at = now;
  if (table === "bookings" && result.is_new_patient === void 0) result.is_new_patient = false;
  return result;
}
__name(withInsertDefaults, "withInsertDefaults");
function toDatabaseValue(table, column, value) {
  if (value === void 0 || value === null) return null;
  const key = `${table}.${column}`;
  if (JSON_COLUMNS.has(key)) return JSON.stringify(value);
  if (BOOLEAN_COLUMNS.has(key)) return value ? 1 : 0;
  return scalarValue(value);
}
__name(toDatabaseValue, "toDatabaseValue");
function scalarValue(value) {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  throw new Error("filter value must be scalar");
}
__name(scalarValue, "scalarValue");
function identifier(table, column) {
  validateColumns(table, [column]);
  return quoteIdentifier(column);
}
__name(identifier, "identifier");
function validateColumns(table, columns) {
  const allowed = TABLE_COLUMNS[table];
  if (!allowed || columns.some((column) => !allowed.includes(column))) throw new Error("unknown table or column");
}
__name(validateColumns, "validateColumns");
function primaryKeyFor(table) {
  return table === "staffs" ? "name" : "id";
}
__name(primaryKeyFor, "primaryKeyFor");
function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}
__name(quoteIdentifier, "quoteIdentifier");
function parseDatabaseQuery(value) {
  if (!isRecord3(value)) return { ok: false, code: "INVALID_QUERY", message: "invalid database query" };
  const operation = value.operation;
  if (typeof value.table !== "string" || !TABLE_COLUMNS[value.table]) {
    return { ok: false, code: "INVALID_QUERY", message: "invalid database query" };
  }
  if (!["select", "insert", "update", "upsert", "delete"].includes(String(operation))) {
    return { ok: false, code: "INVALID_QUERY", message: "invalid database query" };
  }
  if (value.filters !== void 0 && !Array.isArray(value.filters)) {
    return { ok: false, code: "INVALID_FILTER", message: "invalid filter" };
  }
  if (Array.isArray(value.filters) && value.filters.some((item) => !isFilter(item))) {
    return { ok: false, code: "INVALID_FILTER", message: "invalid filter" };
  }
  if (value.or !== void 0 && (!Array.isArray(value.or) || value.or.some((item) => typeof item !== "string"))) {
    return { ok: false, code: "INVALID_FILTER", message: "invalid filter" };
  }
  if (value.order !== void 0 && (!Array.isArray(value.order) || value.order.some((item) => !isOrder(item)))) {
    return { ok: false, code: "INVALID_QUERY", message: "invalid database query" };
  }
  if (value.range !== void 0) {
    if (!isRecord3(value.range) || !Number.isInteger(value.range.from) || !Number.isInteger(value.range.to)) {
      return { ok: false, code: "INVALID_QUERY", message: "invalid database query" };
    }
  }
  const range = isRecord3(value.range) && Number.isInteger(value.range.from) && Number.isInteger(value.range.to) ? { from: Number(value.range.from), to: Number(value.range.to) } : void 0;
  return {
    ok: true,
    query: {
      table: value.table,
      operation,
      columns: typeof value.columns === "string" ? value.columns : void 0,
      payload: value.payload,
      filters: Array.isArray(value.filters) ? value.filters : [],
      or: Array.isArray(value.or) ? value.or : [],
      order: Array.isArray(value.order) ? value.order : [],
      limit: Number.isInteger(value.limit) ? Number(value.limit) : void 0,
      range,
      single: value.single === true,
      maybeSingle: value.maybeSingle === true,
      returning: value.returning === true,
      onConflict: typeof value.onConflict === "string" ? value.onConflict : void 0
    }
  };
}
__name(parseDatabaseQuery, "parseDatabaseQuery");
function isFilter(value) {
  return isRecord3(value) && typeof value.column === "string" && typeof value.operator === "string" && ["eq", "neq", "gt", "gte", "lt", "lte", "is", "in", "not"].includes(value.operator);
}
__name(isFilter, "isFilter");
function isOrder(value) {
  return isRecord3(value) && typeof value.column === "string" && typeof value.ascending === "boolean";
}
__name(isOrder, "isOrder");
function isRecord3(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
__name(isRecord3, "isRecord");
function apiJson2(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
__name(apiJson2, "apiJson");
function apiError2(message, code, status) {
  return apiJson2({ error: { message, code, details: null } }, status);
}
__name(apiError2, "apiError");

// src/patient-api.ts
async function handlePatientApi(request, env, path) {
  const user = await getSupabaseUser(request, env);
  if (!user) return apiError3("auth required", "AUTH_REQUIRED", 401);
  if (path === "/api/patient/bookings" && request.method === "POST") {
    return createBooking(request, env, user.id);
  }
  const match = path.match(/^\/api\/patient\/bookings\/([A-Z0-9-]{1,64})(?:\/(cancel))?$/i);
  if (!match) return apiError3("not found", "NOT_FOUND", 404);
  const bookingId = match[1];
  if (request.method === "GET" && !match[2]) return getBooking(env, user.id, bookingId);
  if (request.method === "POST" && match[2] === "cancel") return cancelBooking(env, user.id, bookingId);
  return apiError3("method not allowed", "METHOD_NOT_ALLOWED", 405);
}
__name(handlePatientApi, "handlePatientApi");
async function createBooking(request, env, userId) {
  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (contentLength > 16e3) return apiError3("request is too large", "PAYLOAD_TOO_LARGE", 413);
  let value;
  try {
    value = await request.json();
  } catch {
    return apiError3("invalid json", "INVALID_JSON", 400);
  }
  const input = parseBookingInput(value);
  if (!input) return apiError3("\u4E88\u7D04\u5185\u5BB9\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093", "INVALID_BOOKING", 400);
  const today = tokyoDateString(/* @__PURE__ */ new Date());
  const maxDate = addDays(today, MAX_DAYS_AHEAD);
  if (input.date < today || input.date > maxDate) {
    return apiError3(`${MAX_DAYS_AHEAD}\u65E5\u5148\u307E\u3067\u4E88\u7D04\u3067\u304D\u307E\u3059`, "DATE_OUT_OF_RANGE", 400);
  }
  if (!isValidDuration(input.start_time, input.end_time)) {
    return apiError3("\u65BD\u8853\u6642\u9593\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093", "INVALID_DURATION", 400);
  }
  if (input.date === today && input.start_time <= tokyoTimeString(/* @__PURE__ */ new Date())) {
    return apiError3("\u904E\u53BB\u306E\u6642\u9593\u306F\u4E88\u7D04\u3067\u304D\u307E\u305B\u3093", "PAST_TIME", 409);
  }
  const overrideResult = await env.DB.prepare(`
    SELECT time FROM blocks
    WHERE date = ? AND staff = ? AND reason = '__OPEN_OVERRIDE__'
      AND time >= ? AND time < ?
  `).bind(input.date, input.staff, input.start_time, input.end_time).all();
  const overrides = new Set(overrideResult.results.map((row) => row.time));
  for (const slot of bookingSlots(input.start_time, input.end_time)) {
    if (!isNormallyOpen(input.date, slot, input.staff) && !overrides.has(slot)) {
      return apiError3("\u9078\u629E\u3057\u305F\u6642\u9593\u5E2F\u306F\u8A3A\u7642\u6642\u9593\u5916\u307E\u305F\u306F\u5B9A\u4F11\u65E5\u3067\u3059", "OUTSIDE_BUSINESS_HOURS", 409);
    }
  }
  const saved = await insertBookingIfAvailable(env.DB, {
    ...input,
    fee: 0,
    user_id: userId
  }, {
    action: "\u60A3\u8005\u304C\u4E88\u7D04",
    details: `${input.date} ${input.start_time}\u301C${input.end_time} ${input.staff} \u306E\u4E88\u7D04\u3092\u767B\u9332`,
    userEmail: null
  });
  if (!saved.ok) return apiError3(saved.message, saved.code, saved.status);
  return apiJson3({ booking: saved.booking }, 201);
}
__name(createBooking, "createBooking");
async function getBooking(env, userId, bookingId) {
  const booking = await env.DB.prepare(`
    SELECT id, date, start_time, end_time, staff, patient_name, phone, symptoms, status
    FROM bookings
    WHERE id = ? AND user_id = ? AND COALESCE(status, '') <> '\u30AD\u30E3\u30F3\u30BB\u30EB'
  `).bind(bookingId, userId).first();
  if (!booking) return apiError3("\u4E88\u7D04\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093", "NOT_FOUND", 404);
  return apiJson3({ booking });
}
__name(getBooking, "getBooking");
async function cancelBooking(env, userId, bookingId) {
  const saved = await cancelBookingIfAllowed(env.DB, {
    bookingId,
    userId,
    minDateExclusive: tokyoDateString(/* @__PURE__ */ new Date())
  }, {
    action: "\u60A3\u8005\u304C\u30AD\u30E3\u30F3\u30BB\u30EB",
    userEmail: null
  });
  if (!saved.ok) return apiError3(saved.message, saved.code, saved.status);
  return apiJson3({ ok: true });
}
__name(cancelBooking, "cancelBooking");
function parseBookingInput(value) {
  if (!isRecord4(value)) return null;
  const input = {
    date: stringValue2(value.date),
    start_time: stringValue2(value.start_time),
    end_time: stringValue2(value.end_time),
    staff: stringValue2(value.staff),
    patient_name: stringValue2(value.patient_name).trim(),
    phone: stringValue2(value.phone),
    symptoms: stringValue2(value.symptoms).trim()
  };
  if (!DATE_RE.test(input.date) || !isValidIsoDate(input.date)) return null;
  if (!TIME_RE.test(input.start_time) || !TIME_RE.test(input.end_time)) return null;
  if (!STAFFS.has(input.staff) || !input.patient_name || input.patient_name.length > 50) return null;
  if (!/^\d{10,15}$/.test(input.phone) || input.symptoms.length > 500) return null;
  return input;
}
__name(parseBookingInput, "parseBookingInput");
function stringValue2(value) {
  return typeof value === "string" ? value : "";
}
__name(stringValue2, "stringValue");
function isRecord4(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
__name(isRecord4, "isRecord");
function apiJson3(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
__name(apiJson3, "apiJson");
function apiError3(message, code, status) {
  return apiJson3({ error: { message, code, details: null } }, status);
}
__name(apiError3, "apiError");

// src/index.ts
var APEX_HOST = "89center.dev";
var ADMIN_HOST = "admin.89center.dev";
var BOOKING_HOSTS = /* @__PURE__ */ new Set([APEX_HOST, `www.${APEX_HOST}`]);
var ADMIN_HOSTS = /* @__PURE__ */ new Set([ADMIN_HOST]);
var LEGACY_PREFIX = "/89-booking-system";
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    if (host === APEX_HOST) {
      const dest = new URL(url.pathname + url.search, env.BOOKING_ORIGIN);
      return redirect(dest);
    }
    const isAdminHost = ADMIN_HOSTS.has(host);
    const isBookingHost = BOOKING_HOSTS.has(host) || host.endsWith(".workers.dev");
    try {
      const apiResponse = await handleApi(request, env);
      if (apiResponse) {
        return withSecurityHeaders(apiResponse, isAdminHost);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(JSON.stringify({ message: "unhandled api error", path: url.pathname, error: message }));
      return withSecurityHeaders(json({ error: "internal server error" }, 500), isAdminHost);
    }
    if (url.pathname === LEGACY_PREFIX || url.pathname.startsWith(`${LEGACY_PREFIX}/`)) {
      url.pathname = url.pathname.slice(LEGACY_PREFIX.length) || "/";
    }
    if (isBookingHost && isAdminPath(url.pathname)) {
      return redirect(new URL("/", env.ADMIN_ORIGIN));
    }
    if (isAdminHost && isBookingHomePath(url.pathname)) {
      return redirect(new URL("/", env.BOOKING_ORIGIN));
    }
    const assetRequest = rewriteAssetRequest(request, url, isAdminHost);
    const assetResponse = await env.ASSETS.fetch(assetRequest);
    return withSecurityHeaders(assetResponse, isAdminHost);
  }
};
async function handleApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/db") {
    return handleDatabaseApi(request, env);
  }
  if (url.pathname.startsWith("/api/admin/")) {
    return handleAdminApi(request, env, url.pathname);
  }
  if (url.pathname.startsWith("/api/patient/")) {
    return handlePatientApi(request, env, url.pathname);
  }
  if (url.pathname === "/api/alert") {
    return handleAlert(request, env);
  }
  if (!url.pathname.startsWith("/api/occupancy")) {
    return null;
  }
  if (url.pathname === "/api/occupancy" && request.method === "GET") {
    const date = url.searchParams.get("date") || "";
    if (!isValidIsoDate(date) || !isOccupancyDateAllowed(date)) {
      return json({ error: "invalid date" }, 400);
    }
    const user = await getSupabaseUser(request, env);
    const [bookResult, blockResult] = await env.DB.batch([
      env.DB.prepare(`
        SELECT id, start_time, end_time, staff, user_id
        FROM bookings
        WHERE date = ? AND (status IS NULL OR status <> '\u30AD\u30E3\u30F3\u30BB\u30EB')
      `).bind(date),
      env.DB.prepare(`
        SELECT staff, time, reason FROM blocks WHERE date = ?
      `).bind(date)
    ]);
    const books = bookResult.results.map((book) => ({
      id: String(book.id || ""),
      start_time: String(book.start_time || ""),
      end_time: String(book.end_time || ""),
      staff: String(book.staff || ""),
      user_id: user && book.user_id === user.id ? user.id : null
    }));
    const blocks = blockResult.results.map((block) => ({
      staff: String(block.staff || ""),
      time: String(block.time || ""),
      reason: block.reason === null ? null : String(block.reason || "")
    }));
    return json({
      synced: true,
      books,
      blocks
    });
  }
  return json({ error: "not found" }, 404);
}
__name(handleApi, "handleApi");
var ALERT_COOLDOWN_SEC = 30 * 60;
var ALERT_HOUR_CAP = 8;
async function handleAlert(request, env) {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }
  if (!isAllowedAlertOrigin(request, env)) {
    return json({ error: "forbidden" }, 403);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const source = sanitizeAlertText(body.source || "unknown", 20);
  const kind = sanitizeAlertText(body.kind || "unknown", 40);
  const message = sanitizeAlertText(body.message || "\u30A8\u30E9\u30FC", 300);
  const detail = sanitizeAlertText(body.detail || "", 800);
  const pageUrl = sanitizeAlertText(body.url || "", 200);
  if (!kind || kind === "unknown") {
    return json({ error: "kind required" }, 400);
  }
  const hourKey = `alert:hour:${(/* @__PURE__ */ new Date()).toISOString().slice(0, 13)}`;
  const hourCount = Number(await env.OCCUPANCY.get(hourKey) || "0");
  if (hourCount >= ALERT_HOUR_CAP) {
    return json({ ok: true, skipped: "hourly-cap" });
  }
  const cooldownKey = `alert:cool:${source}:${kind}:${message.slice(0, 80)}`;
  if (await env.OCCUPANCY.get(cooldownKey)) {
    return json({ ok: true, skipped: "cooldown" });
  }
  const when = (/* @__PURE__ */ new Date()).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const text = [
    "89CENTER\u4E88\u7D04\u30B7\u30B9\u30C6\u30E0\u3067\u4E0D\u5177\u5408\u3092\u691C\u77E5\u3057\u307E\u3057\u305F\u3002",
    "",
    `\u65E5\u6642: ${when}`,
    `\u753B\u9762: ${source === "admin" ? "\u7BA1\u7406\u753B\u9762" : "\u60A3\u8005\u753B\u9762"}`,
    `\u7A2E\u985E: ${kind}`,
    `\u5185\u5BB9: ${message}`,
    detail ? `\u8A73\u7D30: ${detail}` : "",
    pageUrl ? `URL: ${pageUrl}` : "",
    "",
    "\u203B\u540C\u3058\u5185\u5BB9\u306F30\u5206\u9593\u306F\u518D\u9001\u3057\u307E\u305B\u3093\u3002",
    "\u203B\u540D\u524D\u3084\u96FB\u8A71\u756A\u53F7\u306F\u9001\u3063\u3066\u3044\u307E\u305B\u3093\u3002"
  ].filter(Boolean).join("\n");
  try {
    await env.ALERT_EMAIL.send({
      to: env.ALERT_TO_EMAIL,
      from: {
        email: env.ALERT_FROM_EMAIL,
        name: "89CENTER\u4E88\u7D04"
      },
      subject: `\u3010\u4E88\u7D04\u30A8\u30E9\u30FC\u3011${kind} / ${source === "admin" ? "\u7BA1\u7406\u753B\u9762" : "\u60A3\u8005\u753B\u9762"}`,
      text
    });
    await env.OCCUPANCY.put(cooldownKey, "1", { expirationTtl: ALERT_COOLDOWN_SEC });
    await env.OCCUPANCY.put(hourKey, String(hourCount + 1), { expirationTtl: 60 * 60 });
    return json({ ok: true, emailed: true });
  } catch (error) {
    const err = error;
    console.error("alert email failed", err.code, err.message);
    return json({ ok: true, emailed: false, reason: err.code || err.message || "send-failed" });
  }
}
__name(handleAlert, "handleAlert");
function isAllowedAlertOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const referer = request.headers.get("Referer") || "";
  const allowed = [
    env.BOOKING_ORIGIN,
    env.ADMIN_ORIGIN,
    "https://booking-89center.uken-shohei.workers.dev"
  ];
  return allowed.some((base) => origin.startsWith(base) || referer.startsWith(base));
}
__name(isAllowedAlertOrigin, "isAllowedAlertOrigin");
function sanitizeAlertText(value, max) {
  return String(value || "").replace(/\b\d{10,15}\b/g, "[tel]").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}
__name(sanitizeAlertText, "sanitizeAlertText");
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
__name(json, "json");
function isAdminPath(pathname) {
  return pathname === "/admin" || pathname === "/admin/" || pathname === "/admin.html";
}
__name(isAdminPath, "isAdminPath");
function isBookingHomePath(pathname) {
  return pathname === "/booking" || pathname === "/booking/" || pathname === "/booking.html";
}
__name(isBookingHomePath, "isBookingHomePath");
function rewriteAssetRequest(request, url, isAdminHost) {
  const rewritten = new URL(url);
  if (isAdminHost && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/index")) {
    rewritten.pathname = "/admin.html";
    return new Request(rewritten, request);
  }
  if (!isAdminHost && (url.pathname === "/" || url.pathname === "/index")) {
    rewritten.pathname = "/index.html";
    return new Request(rewritten, request);
  }
  if (rewritten.href === request.url) {
    return request;
  }
  return new Request(rewritten, request);
}
__name(rewriteAssetRequest, "rewriteAssetRequest");
function redirect(destination) {
  return new Response(null, {
    status: 301,
    headers: {
      Location: destination.toString(),
      "Cache-Control": "no-store"
    }
  });
}
__name(redirect, "redirect");
function withSecurityHeaders(response, isAdmin) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", isAdmin ? "DENY" : "SAMEORIGIN");
  if (isAdmin) {
    headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  const contentType = headers.get("Content-Type") ?? "";
  if (contentType.includes("text/html")) {
    headers.set("Cache-Control", "no-cache, must-revalidate");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
__name(withSecurityHeaders, "withSecurityHeaders");
export {
  index_default as default
};
//# sourceMappingURL=index.js.map

