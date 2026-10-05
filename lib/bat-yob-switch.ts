// Whether the schedule looks up BAT players' birth years. BAT has no batch
// source for them: each one costs two requests to BAT, and a schedule view
// asked for a whole day's players, so opening a tournament nobody had opened
// before walked its entire roster — about a third of all requests to BAT on a
// busy day, in bursts anyone (or any crawler) could set off. Off until the
// years are filled in at a steady pace instead. Read by both the browser
// (MatchSchedule) and the server (/api/bat/player-ages), so pages already
// open in a browser stop costing anything too.
export const BAT_YOB_LOOKUP_ENABLED = false
