import Foundation

/// Client-side date helpers. The authoritative semantic→absolute conversion happens on the backend
/// (DateService.ts); this mirror exists for offline manual input and Siri phrases like "завтра".
enum DateService {
    static var calendar: Calendar { var c = Calendar.current; c.firstWeekday = 2; return c }

    static func time(_ hhmm: String) -> (Int, Int) {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        return parts.count == 2 ? (parts[0], parts[1]) : (9, 0)
    }

    static func combine(day: Date, hhmm: String) -> Date {
        let (h, m) = time(hhmm)
        return calendar.date(bySettingHour: h, minute: m, second: 0, of: day) ?? day
    }

    static func startOfDay(_ d: Date = .now) -> Date { calendar.startOfDay(for: d) }
    static func endOfDay(_ d: Date = .now) -> Date { calendar.date(byAdding: .day, value: 1, to: startOfDay(d))!.addingTimeInterval(-1) }
    static func isToday(_ d: Date) -> Bool { calendar.isDateInToday(d) }
    static func isTomorrow(_ d: Date) -> Bool { calendar.isDateInTomorrow(d) }

    /// Resolve a small set of natural phrases offline (Siri / quick add). Returns nil when unsure.
    static func resolvePhrase(_ phrase: String, prefs: PreferenceProfile, now: Date = .now) -> Date? {
        let p = phrase.lowercased()
        var day: Date? = nil
        if p.contains("послезавтра") || p.contains("day after tomorrow") { day = calendar.date(byAdding: .day, value: 2, to: now) }
        else if p.contains("завтра") || p.contains("tomorrow") || p.contains("ертең") { day = calendar.date(byAdding: .day, value: 1, to: now) }
        else if p.contains("сегодня") || p.contains("today") || p.contains("бүгін") { day = now }
        let weekdays: [(String, Int)] = [("понедельник", 2), ("вторник", 3), ("сред", 4), ("четверг", 5), ("пятниц", 6), ("суббот", 7), ("воскресен", 1),
                                         ("monday", 2), ("tuesday", 3), ("wednesday", 4), ("thursday", 5), ("friday", 6), ("saturday", 7), ("sunday", 1)]
        for (name, wd) in weekdays where p.contains(name) {
            day = calendar.nextDate(after: now.addingTimeInterval(-1), matching: DateComponents(weekday: wd), matchingPolicy: .nextTime)
        }
        var hhmm: String? = nil
        if p.contains("утр") || p.contains("morning") || p.contains("таң") { hhmm = prefs.morningTime }
        else if p.contains("вечер") || p.contains("evening") || p.contains("кеш") { hhmm = prefs.eveningTime }
        else if p.contains("днём") || p.contains("днем") || p.contains("afternoon") { hhmm = prefs.dayTime }
        if let m = p.range(of: #"(\d{1,2})[:.](\d{2})"#, options: .regularExpression) { hhmm = String(p[m]).replacingOccurrences(of: ".", with: ":") }
        else if let m = p.range(of: #"в (\d{1,2})\b"#, options: .regularExpression) {
            let digits = p[m].filter(\.isNumber); if let h = Int(digits), h < 24 { hhmm = String(format: "%02d:00", h) }
        }
        guard day != nil || hhmm != nil else { return nil }
        var result = combine(day: day ?? now, hhmm: hhmm ?? prefs.endOfDayTime)
        if day == nil, result < now { result = calendar.date(byAdding: .day, value: 1, to: result)! }
        return result
    }

    static func relativeLabel(_ d: Date) -> String {
        if isToday(d) { return "Сегодня, " + d.formatted(date: .omitted, time: .shortened) }
        if isTomorrow(d) { return "Завтра, " + d.formatted(date: .omitted, time: .shortened) }
        return d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute())
    }

    static func absoluteLabel(_ d: Date) -> String {
        d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute())
    }
}
