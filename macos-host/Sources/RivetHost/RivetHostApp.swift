import SwiftUI
import AppKit
import PDFKit

@main
struct PDFGistApp: App {
    @StateObject private var model = PDFGistModel()

    var body: some Scene {
        WindowGroup(RivetGeneratedConfig.displayName) {
            ContentView()
                .environmentObject(model)
                .frame(minWidth: 960, minHeight: 620)
        }
        .defaultSize(width: 1280, height: 820)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button(L10n.t("ui.toolbar.open")) { HostActions.open?() }
                    .keyboardShortcut("o")
            }
            CommandGroup(after: .newItem) {
                Button(L10n.t("ui.update.check-menu")) { model.checkForUpdates() }
                    .keyboardShortcut("u", modifiers: .command)
            }
            CommandMenu(L10n.t("ui.menu.document")) {
                Button(L10n.t("ui.toolbar.find")) { HostActions.find?() }
                    .keyboardShortcut("f")
                Button(L10n.t("ui.toolbar.bookmark")) { HostActions.toggleBookmark?() }
                    .keyboardShortcut("b")
                Button(L10n.t("ui.toolbar.print")) { HostActions.printDocument?() }
                    .keyboardShortcut("p")
                Divider()
                Button(L10n.t("ui.toolbar.tab-close")) {
                    if HostActions.closeTab?() == true {} // ⌘W itself is handled by the event monitor
                }
            }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var keyMonitor: Any?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // ⌘W must close the current document tab, not the window (v1 parity).
        // The system Close command keeps working once every tab is closed.
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            guard event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting(.numericPad) == .command,
                  event.charactersIgnoringModifiers == "w" else { return event }
            let handled = MainActor.assumeIsolated { HostActions.closeTab?() ?? false }
            return handled ? nil : event
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
    }
}
