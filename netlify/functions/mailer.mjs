// Shared email transport for the Netlify functions.
// Gmail SMTP (same account as the Supabase auth emails): GMAIL_USER, GMAIL_APP_PASSWORD, MAIL_FROM.
// Resend as an alternative: RESEND_API_KEY, MAIL_FROM. Without either, nothing is sent and the log records why.
import nodemailer from "nodemailer";

export async function sendMail({ to, subject, html, replyTo }) {
  const { GMAIL_USER, GMAIL_APP_PASSWORD, RESEND_API_KEY, MAIL_FROM } = process.env;
  const from = MAIL_FROM || (GMAIL_USER ? `NRC Referee Hub <${GMAIL_USER}>` : "NRC Referee Hub <onboarding@resend.dev>");
  try {
    if (GMAIL_USER && GMAIL_APP_PASSWORD) {
      const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 587, secure: false, auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
      await t.sendMail({ from, to, subject, html, replyTo: replyTo || process.env.CONTACT_EMAIL || "referee@handballusa.org" });
      return { sent: true, error: null };
    }
    if (RESEND_API_KEY) {
      const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, html, reply_to: replyTo }) });
      return { sent: res.ok, error: res.ok ? null : await res.text() };
    }
    return { sent: false, error: "No email transport configured (GMAIL_USER and GMAIL_APP_PASSWORD, or RESEND_API_KEY)" };
  } catch (e) {
    return { sent: false, error: String(e && e.message || e) };
  }
}

export const fmtDate = d => new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

export function coverage(t) {
  return [
    t.flights_covered ? "Flights covered" : "Flights not covered",
    (t.hotel_nights_covered || 0) + " hotel night" + (t.hotel_nights_covered === 1 ? "" : "s") + " covered",
    t.airport_transfers_covered ? "Airport transfers covered" + (t.airport_transfer_how ? " (" + t.airport_transfer_how + ")" : "") : "Airport transfers not covered",
    t.hotel_to_venue_transport ? "Hotel to venue: " + t.hotel_to_venue_transport : null,
    t.food_stipend_per_day ? "Food stipend: $" + t.food_stipend_per_day + " per day" : (t.meals_provided ? "Meals: " + t.meals_provided : null),
    t.earliest_return_last_day ? "Earliest departure on the last day: " + String(t.earliest_return_last_day).slice(0, 5) : null,
    t.supervisor_needed ? "An NRC supervisor is requested on site" : null
  ].filter(Boolean);
}
