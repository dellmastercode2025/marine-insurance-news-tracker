import SwiftUI

/// Fifth tab: sections that do not need a permanent slot in the bottom bar.
struct MoreView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Информация") {
                    NavigationLink { MailView() } label: { Label("Переписки · письма без ответа", systemImage: "envelope.badge") }
                    NavigationLink { NewsView() } label: { Label("Новости страхования", systemImage: "newspaper") }
                }
                Section("Справочники") {
                    NavigationLink { PeopleView() } label: { Label("Люди и организации", systemImage: "person.2") }
                    NavigationLink { VoiceLogView() } label: { Label("Голосовые записи", systemImage: "waveform") }
                    NavigationLink { SmartInboxView() } label: { Label("Smart Inbox", systemImage: "tray") }
                    NavigationLink { PlanView() } label: { Label("План по датам", systemImage: "calendar") }
                }
                Section { NavigationLink { SettingsView() } label: { Label("Настройки", systemImage: "gearshape") } }
            }
            .navigationTitle("Ещё")
        }
    }
}
