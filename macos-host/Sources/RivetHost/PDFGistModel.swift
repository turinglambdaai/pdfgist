import SwiftUI
import AppKit
import AVFoundation
import PDFKit
import WebKit
import UniformTypeIdentifiers
import RivetEmbedding
import RivetRuntime

/// App-wide action hooks so the Commands menu and the ⌘W event monitor can
/// reach the model without threading it through the scene graph.
enum HostActions {
    nonisolated(unsafe) static var open: (() -> Void)?
    nonisolated(unsafe) static var find: (() -> Void)?
    nonisolated(unsafe) static var toggleBookmark: (() -> Void)?
    nonisolated(unsafe) static var closeTab: (() -> Bool)?
    nonisolated(unsafe) static var zoomIn: (() -> Void)?
    nonisolated(unsafe) static var zoomOut: (() -> Void)?
    nonisolated(unsafe) static var printDocument: (() -> Void)?
    nonisolated(unsafe) static var toggleTTS: (() -> Void)?
    nonisolated(unsafe) static var pageEdit: ((PageEditOp) -> Void)?
}

/// v1 editor.ts operations. In-memory like v1: the source file on disk is
/// never touched; extract/bake go through a save panel.
enum PageEditOp {
    case deleteCurrent
    case rotateCurrent
    case insertBlankAfterCurrent
    case extract(pages: [Int64])
    case merge(path: String)
}

// MARK: - annotation storage types (JSON schema of racket/pdfgist/annotations.rkt)

struct AnnoRect: Codable, Equatable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double

    var nsRect: NSRect { NSRect(x: x, y: y, width: width, height: height) }
    init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x; self.y = y; self.width = width; self.height = height
    }
    init(_ rect: NSRect) {
        x = Double(rect.minX); y = Double(rect.minY)
        width = Double(rect.width); height = Double(rect.height)
    }
}

struct StoredAnnotation: Codable, Identifiable, Equatable {
    var id: String
    var page: Int
    var rects: [AnnoRect]
    var excerpt: String
    var color: String
    var kind: String
    var note: String
    var created: Int
}

struct StoredBookmark: Codable, Identifiable, Equatable {
    var page: Int
    var label: String
    var created: Int
    var id: Int { page }
}

struct DocData: Codable, Equatable {
    var annotations: [StoredAnnotation]
    var bookmarks: [StoredBookmark]
    static let empty = DocData(annotations: [], bookmarks: [])
}

// MARK: - streaming card

/// One AI stream: buffers reasoning/content per the v1 StreamBuffer semantics —
/// reasoning accumulates until the first answer delta; a reasoning-only stream
/// ends as dimmed reasoning; nothing at all becomes （已停止）/（无返回内容）.
@MainActor
final class StreamCard: ObservableObject, Identifiable {
    enum Phase: Equatable {
        case streaming
        case done
        case empty(stopped: Bool)
        case error(String)
        case notice(String)
    }

    let id = UUID()
    var requestId: Int64
    let title: String
    let meta: String
    let sourceText: String
    @Published var reasoning = ""
    @Published var content = ""
    @Published var phase: Phase = .streaming

    init(requestId: Int64 = -1, title: String, meta: String = "", sourceText: String = "") {
        self.requestId = requestId
        self.title = title
        self.meta = meta
        self.sourceText = sourceText
    }

    static func makeNotice(_ message: String) -> StreamCard {
        let card = StreamCard(title: "")
        card.phase = .notice(message)
        return card
    }

    func push(_ delta: String, reasoning isReasoning: Bool) {
        if isReasoning {
            if content.isEmpty { reasoning += delta }
        } else {
            content += delta
        }
    }

    func finish(stopped: Bool = false) {
        if content.isEmpty && reasoning.isEmpty {
            phase = .empty(stopped: stopped)
        } else {
            phase = .done
        }
    }

    func fail(_ message: String) {
        phase = .error(message)
    }

    var copyText: String {
        if !content.isEmpty { return content }
        return reasoning
    }
}

// MARK: - PDF tab

struct OutlineNode: Identifiable {
    let id = UUID()
    let label: String
    let destination: PDFDestination?
    let children: [OutlineNode]
}

@MainActor
final class PDFTab: ObservableObject, Identifiable {
    let id = UUID()
    let path: String
    let title: String
    let pdfView: GistPDFView
    let splitPdfView: GistPDFView
    weak var model: PDFGistModel?

    @Published var pageCount = 0
    @Published var currentPage = 1
    @Published var scalePercent = 100
    @Published var isBookmarked = false
    @Published var docData = DocData.empty
    @Published var outline: [OutlineNode] = []
    @Published var splitOn = false

    var resumePage = 1
    var didInitialLayout = false
    var recentTask: Task<Void, Never>?
    var annoTask: Task<Void, Never>?

    init(path: String, title: String, document: PDFDocument, model: PDFGistModel) {
        self.path = path
        self.title = title
        self.model = model
        let view = GistPDFView()
        view.minScaleFactor = 0.4
        view.maxScaleFactor = 4.0
        view.autoScales = false
        view.displayMode = model.settings.view_mode == "double" ? .twoUp : .singlePage
        view.displaysPageBreaks = true
        view.document = document
        self.pdfView = view
        // Split mirror (v1 viewer-split): shares the document, has no
        // toolbar state of its own, only follows the main view's scroll.
        let split = GistPDFView()
        split.minScaleFactor = 0.4
        split.maxScaleFactor = 4.0
        split.autoScales = false
        split.displayMode = view.displayMode
        split.displaysPageBreaks = true
        split.document = document
        self.splitPdfView = split
        view.hostTab = self
        self.pageCount = document.pageCount
    }

    var document: PDFDocument? { pdfView.document }

    func goToPage(_ page: Int) {
        guard let doc = document, page >= 1, page <= doc.pageCount,
              let target = doc.page(at: page - 1) else { return }
        let top = NSPoint(x: 0, y: target.bounds(for: .mediaBox).maxY)
        pdfView.go(to: PDFDestination(page: target, at: top))
        currentPage = page
    }

    func zoomIn() {
        if let epub = model?.epubTab, model?.epubActive == true {
            epub.applyFontScale(min(2.0, epub.fontScale * 1.1))
            return
        }
        pdfView.scaleFactor = min(pdfView.scaleFactor * 1.2, pdfView.maxScaleFactor)
    }

    func zoomOut() {
        if let epub = model?.epubTab, model?.epubActive == true {
            epub.applyFontScale(max(0.7, epub.fontScale / 1.1))
            return
        }
        pdfView.scaleFactor = max(pdfView.scaleFactor / 1.2, pdfView.minScaleFactor)
    }

    func zoomReset() {
        pdfView.scaleFactor = 1.0
    }

    func fitWidth() {
        guard let page = pdfView.currentPage ?? document?.page(at: 0) else { return }
        let bounds = page.bounds(for: .mediaBox)
        guard bounds.width > 0, pdfView.bounds.width > 0 else { return }
        let target = (pdfView.bounds.width - 32) / bounds.width
        pdfView.scaleFactor = min(max(target, pdfView.minScaleFactor), pdfView.maxScaleFactor)
    }

    func setDisplayMode(double: Bool) {
        pdfView.displayMode = double ? .twoUp : .singlePage
    }

    func refreshBookmarkFlag() {
        isBookmarked = docData.bookmarks.contains { $0.page == currentPage }
    }

    // MARK: context menu (right-click on a selection)

    func selectionMenu() -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        menu.addItem(BlockMenuItem(title: L10n.t("ui.menu.translate")) { [weak self] in
            self?.model?.translateSelection()
        })
        menu.addItem(.separator())
        let highlightColors: [(String, String)] = [
            ("yellow", "ui.menu.highlight-yellow"),
            ("green", "ui.menu.highlight-green"),
            ("blue", "ui.menu.highlight-blue"),
        ]
        for (color, key) in highlightColors {
            menu.addItem(BlockMenuItem(title: L10n.t(key)) { [weak self] in
                self?.model?.addAnnotationFromSelection(color: color, kind: "highlight")
            })
        }
        menu.addItem(BlockMenuItem(title: L10n.t("ui.menu.underline")) { [weak self] in
            self?.model?.addAnnotationFromSelection(color: "blue", kind: "underline")
        })
        menu.addItem(BlockMenuItem(title: L10n.t("ui.menu.strike")) { [weak self] in
            self?.model?.addAnnotationFromSelection(color: "yellow", kind: "strike")
        })
        menu.addItem(.separator())
        let copy = NSMenuItem(
            title: L10n.t("ui.menu.copy"),
            action: #selector(PDFView.copy(_:)), keyEquivalent: "c")
        copy.target = pdfView
        copy.isEnabled = true
        menu.addItem(copy)
        return menu
    }
}

/// NSMenuItem that fires a closure (no responder-chain plumbing).
@MainActor
final class BlockMenuItem: NSMenuItem {
    @MainActor private let handler: () -> Void

    init(title: String, handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(fire), keyEquivalent: "")
        target = self
    }

    @available(*, unavailable)
    required init(coder: NSCoder) {
        fatalError("not supported")
    }

    @objc private func fire() { handler() }
}

/// PDFView subclass offering the annotation/translate context menu whenever a
/// text selection exists.
final class GistPDFView: PDFView {
    weak var hostTab: PDFTab?

    override func menu(for event: NSEvent) -> NSMenu? {
        guard currentSelection != nil, let tab = hostTab else { return super.menu(for: event) }
        return tab.selectionMenu()
    }

    override func mouseDown(with event: NSEvent) {
        super.mouseDown(with: event)
        if currentSelection == nil {
            hostTab?.model?.selectionCleared()
        }
    }
}

// MARK: - main model

enum AITab: String, CaseIterable, Identifiable {
    case translate, summarize, chat, notes, forms, settings
    var id: String { rawValue }
}

struct ChatBubble: Identifiable {
    let id = UUID()
    let isUser: Bool
    var text: String
    var dimmed: Bool
    var card: StreamCard?

    static func user(_ text: String) -> ChatBubble {
        ChatBubble(isUser: true, text: text, dimmed: false, card: nil)
    }
}

struct PasswordPrompt: Identifiable {
    let id = UUID()
    let wrong: Bool
    let continuation: CheckedContinuation<String?, Never>
}

final class TTSDelegate: NSObject, AVSpeechSynthesizerDelegate {
    weak var model: PDFGistModel?

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in self?.model?.ttsSpeaking = false }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in self?.model?.ttsSpeaking = false }
    }
}

@MainActor
final class PDFGistModel: ObservableObject {
@MainActor
private final class EventRelay {
    weak var model: PDFGistModel?
    init(_ model: PDFGistModel) { self.model = model }
    func receive(_ event: RivetEvent) { model?.receive(event) }
    func ready(settings: SettingsView, presets: [ProviderPreset], recents: [RecentEntry]) {
        model?.relayReady(settings: settings, presets: presets, recents: recents)
    }
    func fail(_ message: String) {
        guard let model else { return }
        model.ready = false
        model.status = message
    }
}

    @Published var ready = false
    @Published var status = ""
    @Published var settings = SettingsView(
        provider: "deepseek", base_url: "", model: "", target_language: .zh,
        view_mode: "single", annotation_sidecar: false, has_api_key: false, recent: [])
    @Published var presets: [ProviderPreset] = []
    @Published var recents: [RecentEntry] = []

    @Published var tabs: [PDFTab] = []
    @Published var activeTabID: PDFTab.ID?
    @Published var epubTab: EpubTab?
    @Published var epubActive = false
    @Published var epubTextReady = false
    @Published var leftPanelVisible = false
    @Published var leftPanelMode = 0  // 0 thumbs / 1 outline
    @Published var aiVisible = true
    @Published var aiTab: AITab = .translate
    @Published var leftWidth: CGFloat
    @Published var aiWidth: CGFloat
    @Published var theme: String
    @Published var showAlert = false
    @Published var alertText = ""
    @Published var passwordPrompt: PasswordPrompt?
    @Published var dropActive = false
    @Published var ttsSpeaking = false

    // AI state
    @Published var translateCards: [StreamCard] = []
    @Published var summarizeCards: [StreamCard] = []
    @Published var chatBubbles: [ChatBubble] = []
    @Published var chatBusy = false
    @Published var chatScope = 0  // 0 page / 1 selection / 2 doc
    @Published var findVisible = false
    @Published var findQuery = ""
    @Published var findTotal = 0
    @Published var findIndex = 0

    private var chatHistory: [[String]] = []
    private var chatLive: StreamCard?
    private var chatPendingQuestion = ""
    private var stoppingStreams: Set<Int64> = []
    private var streamRegistry: [Int64: StreamCard] = [:]
    private var findTask: Task<Void, Never>?
    private var findHits: [PDFSelection] = []
    // EPUB whole-book search results (chapter, ordinal) — v1 EpubHit
    private var epubFindHits: [(chapter: Int, ordinal: Int)] = []
    private var epubFindQuery = ""
    private var epubFindHitIndex = 0

    private var backend: EmbeddedRacketBackend?
    private var apiRef: RivetAPI?

    var activeTab: PDFTab? { epubActive ? nil : tabs.first { $0.id == activeTabID } }

    var resolvedColorScheme: ColorScheme? {
        switch theme {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }

    init() {
        let defaults = UserDefaults.standard
        let storedTheme = defaults.string(forKey: "pdfgist-theme") ?? "system"
        let storedLeft = defaults.double(forKey: "pdfgist-left-w")
        let storedAI = defaults.double(forKey: "pdfgist-sidebar-w")
        leftWidth = min(max(storedLeft == 0 ? 232 : storedLeft, 160), 440)
        aiWidth = min(max(storedAI == 0 ? 400 : storedAI, 280), 680)
        theme = storedTheme
        // v1 UI is Chinese-first; en.json exists, so follow the system locale.
        L10n.language = Locale.preferredLanguages.first?.hasPrefix("zh") == false ? "en" : "zh"
    }

    func persistPanelWidths() {
        let defaults = UserDefaults.standard
        defaults.set(Double(leftWidth), forKey: "pdfgist-left-w")
        defaults.set(Double(aiWidth), forKey: "pdfgist-sidebar-w")
    }

    func setTheme(_ value: String) {
        theme = value
        UserDefaults.standard.set(value, forKey: "pdfgist-theme")
    }

    func toggleTheme() {
        setTheme(resolvedColorScheme == .dark ? "light" : "dark")
    }

    // MARK: backend lifecycle

    func start() {
        guard backend == nil else { return }
        installHostActions()

        do {
            let config = try EmbeddedRacketConfiguration.resolvedDefault(
                moduleName: RivetGeneratedConfig.moduleName,
                entryName: RivetGeneratedConfig.entryName)
            let backend = EmbeddedRacketBackend(configuration: config)
            let relay = EventRelay(self)
            self.backend = backend
            status = "Starting embedded Racket CS…"
            Task.detached { [backend, relay, weak self] in
                do {
                    try backend.start { name, value in
                        guard let event = try? RivetEvent.decode(name: name, value: value) else { return }
                        Task { @MainActor in relay.receive(event) }
                    }
                    let api = RivetAPI(client: backend.client)
                    await MainActor.run { self?.apiRef = api }
                    try await api.initialize()
                    // Backend error strings follow the host locale.
                    try? await api.set_locale(code: L10n.language)
                    async let settings = api.get_settings()
                    async let presets = api.list_presets()
                    async let recents = api.get_recents()
                    let (s, p, r) = try await (settings, presets, recents)
                    await relay.ready(settings: s, presets: p, recents: r)
                    // Open-on-launch stands in for v1's file association. This
                    // rides on an env var because the bare SwiftPM binary
                    // creates no window when launched with a positional
                    // argument; the Windows/Linux hosts wire their own
                    // launch/association convention.
                    if let launch = ProcessInfo.processInfo.environment["PDFGIST_OPEN"],
                       ["pdf", "epub"].contains(
                        URL(fileURLWithPath: launch).pathExtension.lowercased()) {
                        await self?.openPath(launch)
                    }
                } catch {
                    await relay.fail(String(describing: error))
                }
            }
        } catch {
            status = "Configuration error: \(error)"
        }
    }

    private func installHostActions() {
        HostActions.open = { [weak self] in self?.pickAndOpen() }
        HostActions.find = { [weak self] in
            guard let self else { return }
            if self.epubActive {
                if self.epubTab != nil { self.findVisible = true }
                return
            }
            guard self.activeTab != nil else { return }
            self.findVisible = true
        }
        HostActions.toggleBookmark = { [weak self] in self?.toggleBookmark() }
        HostActions.closeTab = { [weak self] in self?.closeActiveReader() ?? false }
        HostActions.printDocument = { [weak self] in self?.printActive() }
        HostActions.toggleTTS = { [weak self] in self?.toggleTTS() }
        HostActions.pageEdit = { [weak self] op in self?.runPageEdit(op) }
        HostActions.zoomIn = { [weak self] in self?.activeTab?.zoomIn() }
        HostActions.zoomOut = { [weak self] in self?.activeTab?.zoomOut() }
    }

    private func bootstrap(settings: SettingsView, presets: [ProviderPreset], recents: [RecentEntry]) {
        self.settings = settings
        self.presets = presets
        self.recents = recents
        ready = true
        status = ""
    }

    // MARK: events

    private func receive(_ event: RivetEvent) {
        switch event {
        case .stream_chunk(let chunk):
            streamRegistry[chunk.request_id]?.push(chunk.delta, reasoning: chunk.is_reasoning)
        case .stream_done(let done):
            finishStream(requestId: done.request_id, error: nil)
        case .stream_error(let error):
            finishStream(requestId: error.request_id, error: error.message)
        }
    }

    private func finishStream(requestId: Int64, error: String?) {
        guard let card = streamRegistry.removeValue(forKey: requestId) else { return }
        let stopped = stoppingStreams.remove(requestId) != nil
        if let error {
            card.fail(error)
        } else {
            card.finish(stopped: stopped)
        }
        if chatLive === card {
            finalizeChat(card)
        }
    }

    // MARK: open / tabs

    func pickAndOpen() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.pdf]
        panel.message = L10n.t("ui.toolbar.open")
        let handle: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            Task { await self?.openPath(url.path) }
        }
        if let window = NSApp.keyWindow {
            panel.beginSheetModal(for: window, completionHandler: handle)
        } else {
            handle(panel.runModal())
        }
    }

    func openDropped(_ urls: [URL]) {
        guard let url = urls.first(where: { ["pdf", "epub"].contains($0.pathExtension.lowercased()) }) else { return }
        Task { await openPath(url.path) }
    }

    func openRecent(_ entry: RecentEntry) {
        Task { await openPath(entry.path, resumePage: Int(entry.page)) }
    }

    func openPath(_ path: String, resumePage: Int = 1) async {
        if path.lowercased().hasSuffix(".epub") {
            await openEpub(path, resumeChapter: resumePage)
            return
        }
        epubActive = false
        if let existing = tabs.first(where: { $0.path == path }) {
            activateTab(existing.id)
            if resumePage > 1 { existing.goToPage(resumePage) }
            return
        }
        guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else {
            alert(L10n.t("ui.open-failed", path))
            return
        }
        var wrong = false
        while doc.isLocked {
            let password = await requestPassword(wrong: wrong)
            guard let password, !password.isEmpty else { return }
            wrong = true
            if doc.unlock(withPassword: password) { break }
        }
        let title = URL(fileURLWithPath: path).lastPathComponent
        let tab = PDFTab(path: path, title: title, document: doc, model: self)
        tab.resumePage = max(resumePage, 1)
        tabs.append(tab)
        if tabs.count == 1 { leftPanelVisible = true }
        activateTab(tab.id)
        loadDocData(tab)
        noteActivity(tab, immediate: true)
    }

    func activateTab(_ id: PDFTab.ID) {
        epubActive = false
        activeTabID = id
        findVisible = false
        findQuery = ""
        clearFindHighlights()
    }

    // MARK: EPUB tab lifecycle

    func openEpub(_ path: String, resumeChapter: Int = 1) async {
        if let existing = epubTab, existing.path == path {
            epubActive = true
            if resumeChapter > 1 { existing.goToChapter(resumeChapter) }
            return
        }
        guard let api = apiRef else {
            alert(L10n.t("ui.backend-not-ready"))
            return
        }
        // one EPUB tab at a time (v1 allowed a mixed tab bar; difference noted)
        if let old = epubTab { old.teardown() }
        let title = URL(fileURLWithPath: path).lastPathComponent
        let config = WKWebViewConfiguration()
        let view = WKWebView(frame: .zero, configuration: config)
        view.setValue(false, forKey: "drawsBackground")
        let tab = EpubTab(path: path, title: title, view: view, model: self)
        epubTab = tab
        epubActive = true
        findVisible = false
        tab.loadBook(api: api)
        if resumeChapter > 1 {
            tab.currentPage = resumeChapter
        }
        noteEpubActivity(tab, immediate: true)
    }

    func activateEpub() {
        epubActive = true
    }

    func closeEpub() {
        if let tab = epubTab {
            tab.teardown()
            saveEpubRecentNow(tab)
        }
        epubTab = nil
        epubActive = false
    }

    func noteEpubChapter(_ tab: EpubTab) {
        noteEpubActivity(tab)
    }

    @discardableResult
    func closeActiveReader() -> Bool {
        if epubActive, epubTab != nil {
            closeEpub()
            return true
        }
        if activeTabID != nil {
            return closeActiveTab()
        }
        return false
    }

    @discardableResult
    func closeTab(_ id: PDFTab.ID) -> Bool {
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return false }
        let tab = tabs.remove(at: index)
        tab.recentTask?.cancel()
        tab.annoTask?.cancel()
        flushAnnotationSave(tab)
        saveRecentNow(tab)
        if activeTabID == id {
            activeTabID = tabs.isEmpty ? nil : tabs[min(index, tabs.count - 1)].id
        }
        return true
    }

    func closeActiveTab() -> Bool {
        guard let id = activeTabID else { return false }
        return closeTab(id)
    }

    func printActive() {
        guard let doc = activeTab?.document,
              let op = doc.printOperation(for: .shared, scalingMode: .pageScaleDownToFit, autoRotate: true)
        else { return }
        op.run()
    }

    // MARK: page-level editing (backend owns the PDF surgery — issue #1)

    func runPageEdit(_ op: PageEditOp) {
        Task { await runPageEditAsync(op) }
    }

    private func runPageEditAsync(_ op: PageEditOp) async {
        guard let tab = activeTab, let api = apiRef else { return }
        let page = Int64(tab.currentPage)
        do {
            let data: Data
            switch op {
            case .deleteCurrent:
                data = try await api.edit_delete_pages(path: tab.path, pages: [page])
            case .rotateCurrent:
                data = try await api.edit_rotate_pages(path: tab.path, pages: [page], delta: 90)
            case .insertBlankAfterCurrent:
                data = try await api.edit_insert_blank_after(path: tab.path, page: page)
            case .extract(let pages):
                let bytes = try await api.edit_extract_pages(path: tab.path, pages: pages)
                try await saveEditResult(bytes,
                                         defaultName: extractName(tab.title))
                return
            case .merge(let otherPath):
                data = try await api.edit_append_doc(path: tab.path, other_path: otherPath)
            }
            reloadTabDocument(tab, data: data)
        } catch let e as ClientError {
            if case .backend(let message) = e {
                alert(L10n.t("ui.pages.edit-failed", message))
            } else {
                alert(L10n.t("ui.pages.edit-failed", String(describing: e)))
            }
        } catch {
            alert(L10n.t("ui.pages.edit-failed", String(describing: error)))
        }
    }

    /// Replace the tab's in-memory document (v1 pdf.reloadBytes parity):
    /// same tab, selection/scroll reset, source file untouched on disk.
    func reloadTabDocument(_ tab: PDFTab, data: Data) {
        guard let newDoc = PDFDocument(data: data) else {
            alert(L10n.t("ui.pages.edit-failed", "unreadable result"))
            return
        }
        tab.pdfView.document = newDoc
        tab.splitPdfView.document = newDoc
        tab.pageCount = newDoc.pageCount
        tab.goToPage(1)
        tab.refreshBookmarkFlag()
    }

    private func extractName(_ title: String) -> String {
        let stem = title.replacingOccurrences(
            of: "\\.pdf$", with: "", options: [.regularExpression, .caseInsensitive])
        return stem + L10n.t("ui.pages.extract-suffix") + ".pdf"
    }

    func saveEditResult(_ data: Data, defaultName: String) async {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.pdf]
        panel.nameFieldStringValue = defaultName
        let response = await panel.beginSheetModal(for: NSApp.mainWindow!)
        guard response == .OK, let url = panel.url else { return }
        do {
            try data.write(to: url)
        } catch {
            alert(L10n.t("ui.pages.save-failed", error.localizedDescription))
        }
    }

    // MARK: TTS (read the current page aloud — v1 main.ts toggleTTS)

    private let synthesizer = AVSpeechSynthesizer()
    private lazy var ttsDelegate = TTSDelegate()

    func toggleTTS() {
        if ttsSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
            ttsSpeaking = false
            return
        }
        if epubActive, let epub = epubTab {
            let raw = epubTextSync(epub) // cache-filled by prefetch
            guard !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                alert(L10n.t("ui.tts.empty"))
                return
            }
            synthesizer.delegate = ttsDelegate
            let utterance = AVSpeechUtterance(string: String(raw.prefix(20000)))
            utterance.voice = AVSpeechSynthesisVoice(language: "zh-CN")
            utterance.rate = AVSpeechUtteranceDefaultSpeechRate
            synthesizer.speak(utterance)
            ttsSpeaking = true
            return
        }
        guard let page = activeTab?.pdfView.currentPage, let raw = page.string else { return }
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            alert(L10n.t("ui.tts.empty"))
            return
        }
        synthesizer.delegate = ttsDelegate
        let utterance = AVSpeechUtterance(string: String(text.prefix(20000)))
        utterance.voice = AVSpeechSynthesisVoice(language: "zh-CN")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        synthesizer.speak(utterance)
        ttsSpeaking = true
    }

    func pageChanged(_ tab: PDFTab) {
        if let page = tab.pdfView.currentPage, let doc = tab.pdfView.document {
            tab.currentPage = doc.index(for: page) + 1
        }
        tab.refreshBookmarkFlag()
        if tab.id == activeTabID {
            noteActivity(tab)
        }
    }

    func scaleChanged(_ tab: PDFTab) {
        tab.scalePercent = Int(round(tab.pdfView.scaleFactor * 100))
    }

    func selectionCleared() {}

    // MARK: recents

    // EPUB recents ride the same update-recents RPC with page = chapter.
    func noteEpubActivity(_ tab: EpubTab, immediate: Bool = false) {
        tab.recentTask?.cancel()
        tab.recentTask = Task { [weak self] in
            if !immediate {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
            guard !Task.isCancelled else { return }
            await self?.saveEpubRecent(tab)
        }
    }

    private func saveEpubRecent(_ tab: EpubTab) async {
        guard ready else { return }
        let pages = max(tab.chapters, 1)
        let ratio = Int64((Double(tab.currentPage) / Double(pages) * 100_000).rounded())
        _ = try? await apiRef?.update_recents(
            path: tab.path, page: Int64(tab.currentPage), scroll_ratio_scaled: ratio)
        if let recents = try? await apiRef?.get_recents() {
            self.recents = recents
        }
    }

    private func saveEpubRecentNow(_ tab: EpubTab) {
        tab.recentTask?.cancel()
        Task { await saveEpubRecent(tab) }
    }

    func noteActivity(_ tab: PDFTab, immediate: Bool = false) {
        tab.recentTask?.cancel()
        tab.recentTask = Task { [weak self] in
            if !immediate {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
            guard !Task.isCancelled else { return }
            await self?.saveRecent(tab)
        }
    }

    private func saveRecent(_ tab: PDFTab) async {
        guard ready else { return }
        let pages = max(tab.pageCount, 1)
        // Page-based scroll estimate; resume only uses the page number.
        let ratio = Int64((Double(tab.currentPage) / Double(pages) * 100_000).rounded())
        _ = try? await apiRef?.update_recents(
            path: tab.path, page: Int64(tab.currentPage), scroll_ratio_scaled: ratio)
        if let recents = try? await apiRef?.get_recents() {
            self.recents = recents
        }
    }

    private func saveRecentNow(_ tab: PDFTab) {
        tab.recentTask?.cancel()
        Task { await saveRecent(tab) }
    }

    // MARK: document data (annotations + bookmarks)

    private func loadDocData(_ tab: PDFTab) {
        Task {
            guard let api = apiRef else { return }
            if let data = try? await api.get_annotations(
                pdf_path: tab.path, sidecar: settings.annotation_sidecar),
               let decoded = try? JSONDecoder().decode(DocData.self, from: data) {
                tab.docData = decoded
                applyStoredAnnotations(tab)
                tab.refreshBookmarkFlag()
                rebuildOutline(tab)
            }
        }
    }

    private func applyStoredAnnotations(_ tab: PDFTab) {
        for annotation in tab.docData.annotations {
            renderAnnotation(annotation, in: tab)
        }
    }

    func renderAnnotation(_ annotation: StoredAnnotation, in tab: PDFTab) {
        guard let doc = tab.document, doc.pageCount >= annotation.page,
              let page = doc.page(at: annotation.page - 1) else { return }
        let type: PDFAnnotationSubtype
        switch annotation.kind {
        case "underline": type = .underline
        case "strike": type = .strikeOut
        default: type = .highlight
        }
        for rect in annotation.rects {
            let bounds = rect.nsRect
            guard bounds.width > 0, bounds.height > 0 else { continue }
            let ann = PDFAnnotation(bounds: bounds, forType: type, withProperties: nil)
            ann.color = Theme.annotationColor(annotation.color)
            ann.userName = "pdfgist:\(annotation.id)"
            page.addAnnotation(ann)
        }
    }

    func addAnnotationFromSelection(color: String, kind: String) {
        guard let tab = activeTab, let selection = tab.pdfView.currentSelection,
              let text = selection.string?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty, let page = selection.pages.first,
              let doc = tab.document else { return }
        let pageNo = doc.index(for: page) + 1
        let rects = selection.selectionsByLine()
            .map { $0.bounds(for: page) }
            .filter { !$0.isEmpty }
            .map(AnnoRect.init)
        let id = String(format: "a-%lld-%04d", Int(Date().timeIntervalSince1970), Int.random(in: 0..<10_000))
        let annotation = StoredAnnotation(
            id: id, page: pageNo, rects: rects,
            excerpt: String(text.prefix(800)), color: color, kind: kind,
            note: "", created: Int(Date().timeIntervalSince1970))
        tab.docData.annotations.append(annotation)
        renderAnnotation(annotation, in: tab)
        queueAnnotationSave(tab)
    }

    func removeAnnotation(_ id: String) {
        guard let tab = activeTab else { return }
        tab.docData.annotations.removeAll { $0.id == id }
        guard let doc = tab.document else { return }
        for index in 0..<doc.pageCount {
            guard let page = doc.page(at: index) else { continue }
            for annotation in page.annotations
            where annotation.userName == "pdfgist:\(id)" {
                page.removeAnnotation(annotation)
            }
        }
        queueAnnotationSave(tab)
    }

    func queueAnnotationSave(_ tab: PDFTab) {
        tab.annoTask?.cancel()
        tab.annoTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 800_000_000)
            guard !Task.isCancelled else { return }
            await self?.storeAnnotationData(tab)
        }
    }

    func flushAnnotationSave(_ tab: PDFTab) {
        tab.annoTask?.cancel()
        Task { await storeAnnotationData(tab) }
    }

    private func storeAnnotationData(_ tab: PDFTab) async {
        guard let api = apiRef else { return }
        guard let data = try? JSONEncoder().encode(tab.docData) else { return }
        try? await api.set_annotations(
            pdf_path: tab.path, sidecar: settings.annotation_sidecar, data: data)
    }

    func toggleBookmark() {
        guard let tab = activeTab else { return }
        if let index = tab.docData.bookmarks.firstIndex(where: { $0.page == tab.currentPage }) {
            tab.docData.bookmarks.remove(at: index)
        } else {
            tab.docData.bookmarks.append(StoredBookmark(
                page: tab.currentPage,
                label: L10n.t("ui.notes.page", "\(tab.currentPage)"),
                created: Int(Date().timeIntervalSince1970)))
        }
        tab.docData.bookmarks.sort { $0.page == $1.page ? $0.created < $1.created : $0.page < $1.page }
        tab.refreshBookmarkFlag()
        queueAnnotationSave(tab)
    }

    func removeBookmark(_ page: Int) {
        guard let tab = activeTab else { return }
        tab.docData.bookmarks.removeAll { $0.page == page }
        tab.refreshBookmarkFlag()
        queueAnnotationSave(tab)
    }

    func rebuildOutline(_ tab: PDFTab) {
        var nodes: [OutlineNode] = []
        if let root = tab.document?.outlineRoot {
            for index in 0..<root.numberOfChildren {
                if let child = root.child(at: index) { nodes.append(outlineNode(child)) }
            }
        }
        tab.outline = nodes
    }

    private func outlineNode(_ outline: PDFOutline) -> OutlineNode {
        var kids: [OutlineNode] = []
        for index in 0..<outline.numberOfChildren {
            if let child = outline.child(at: index) { kids.append(outlineNode(child)) }
        }
        return OutlineNode(label: outline.label ?? "", destination: outline.destination, children: kids)
    }

    func goToOutline(_ node: OutlineNode) {
        guard let tab = activeTab, let destination = node.destination else { return }
        tab.pdfView.go(to: destination)
    }

    // MARK: password prompt

    private func requestPassword(wrong: Bool) async -> String? {
        await withCheckedContinuation { continuation in
            passwordPrompt = PasswordPrompt(wrong: wrong, continuation: continuation)
        }
    }

    func submitPassword(_ password: String) {
        guard let prompt = passwordPrompt else { return }
        passwordPrompt = nil
        prompt.continuation.resume(returning: password)
    }

    func cancelPassword() {
        guard let prompt = passwordPrompt else { return }
        passwordPrompt = nil
        prompt.continuation.resume(returning: nil)
    }

    func alert(_ message: String) {
        alertText = message
        showAlert = true
    }

    // MARK: text sources (parity with the v1 sidebar TextSource)

    func pageText(_ tab: PDFTab, page: Int) -> String? {
        guard let doc = tab.document, page >= 1, page <= doc.pageCount,
              let pageObj = doc.page(at: page - 1) else { return nil }
        return pageObj.string
    }

    func selectionText() -> String? {
        if epubActive, let epub = epubTab {
            let text = epub.pendingSelection?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return text.count > 1 ? text : nil
        }
        guard let tab = activeTab, let selection = tab.pdfView.currentSelection else { return nil }
        let text = selection.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.count > 1 ? text : nil
    }

    /// Whole-document context: first 12 pages, 3000 chars each, `--- 第 N 页 ---`
    /// markers — same payload the v1 viewer assembled.
    func docText(_ tab: PDFTab) -> (pages: Int, text: String)? {
        if epubActive, let epub = epubTab {
            var parts: [String] = []
            var used = 0
            for i in 1...max(1, epub.chapters) {
                let raw = (epub.textCache[i] ?? "")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if raw.isEmpty { continue }
                let slice = raw.count > 3000 ? String(raw.prefix(3000)) + "…" : raw
                parts.append("--- 第 \(i) 章 ---\n\(slice)")
                used += slice.count
                if used >= 24_000 { break }
            }
            return (epub.chapters, parts.joined(separator: "\n\n"))
        }
        guard let doc = tab.document, doc.pageCount > 0 else { return nil }
        let n = min(doc.pageCount, 12)
        var parts: [String] = []
        var used = 0
        for index in 0..<n {
            guard let page = doc.page(at: index),
                  let raw = page.string?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !raw.isEmpty else { continue }
            let slice = raw.count > 3000 ? String(raw.prefix(3000)) + "…" : raw
            parts.append("--- 第 \(index + 1) 页 ---\n\(slice)")
            used += slice.count
            if used >= 24_000 { break }
        }
        return (n, parts.joined(separator: "\n\n"))
    }

    func currentPageText() -> (page: Int, text: String)? {
        if epubActive, let epub = epubTab {
            let chapter = epub.currentPage
            var text = (epub.textCache[chapter] ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty { return nil }
            if text.count > 8000 {
                text = String(text.prefix(8000)) + L10n.t("backend.text.truncated")
            }
            return (chapter, text)
        }
        guard let tab = activeTab else { return nil }
        let page = tab.currentPage
        guard var text = pageText(tab, page: page)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty else { return nil }
        if text.count > 8000 {
            text = String(text.prefix(8000)) + L10n.t("backend.text.truncated")
        }
        return (page, text)
    }

    /// Chapter text from the prefetch cache (openEpub fills it; AI, TTS and
    /// search only ever read).
    func epubTextSync(_ epub: EpubTab, chapter: Int? = nil) -> String {
        let ch = chapter ?? epub.currentPage
        return epub.textCache[ch] ?? ""
    }

    /// Prefetch every chapter's text SERIALLY so AI actions, TTS and
    /// whole-book search read from the cache without waiting. Concurrent
    /// epub RPCs stall on the embedded channel, so this must stay serial.
    func prefetchEpubText(_ epub: EpubTab) {
        guard let api = apiRef else { return }
        Task { [weak self] in
            for i in 1...max(1, epub.chapters) {
                if Task.isCancelled { return }
                let text = (try? await api.epub_chapter_text(path: epub.path, index: Int64(i))) ?? ""
                await MainActor.run { epub.textCache[i] = text }
            }
            await MainActor.run { self?.epubTextReady = true }
        }
    }

    private func relayReady(settings: SettingsView, presets: [ProviderPreset], recents: [RecentEntry]) {
        self.settings = settings
        self.presets = presets
        self.recents = recents
        ready = true
        status = ""
    }

    // MARK: AI streams

    func languageName(_ code: TargetLanguage) -> String {
        switch code {
        case .zh: return "中文"
        case .zh_hant: return "繁體中文"
        case .en: return "English"
        case .ja: return "日本語"
        case .ko: return "한국어"
        case .fr: return "Français"
        case .de: return "Deutsch"
        case .es: return "Español"
        }
    }

    /// v1 ensureProviderConfigured: no base URL/model/key (except local
    /// Ollama) means the settings tab opens with a notice instead.
    private func ensureProvider(
        for keyPath: ReferenceWritableKeyPath<PDFGistModel, [StreamCard]>
    ) -> Bool {
        let ok = !settings.base_url.isEmpty && !settings.model.isEmpty
            && (settings.has_api_key || settings.provider == "ollama")
        if !ok {
            aiTab = .settings
            self[keyPath: keyPath].insert(
                StreamCard.makeNotice(L10n.t("ui.settings.need-config")), at: 0)
        }
        return ok
    }

    private func prependNotice(_ message: String, to keyPath: ReferenceWritableKeyPath<PDFGistModel, [StreamCard]>) {
        self[keyPath: keyPath].insert(StreamCard.makeNotice(message), at: 0)
    }

    func removeCard(_ card: StreamCard) {
        translateCards.removeAll { $0.id == card.id }
        summarizeCards.removeAll { $0.id == card.id }
    }

    private func startCardStream(
        card: StreamCard,
        list: ReferenceWritableKeyPath<PDFGistModel, [StreamCard]>,
        launch: @escaping @MainActor (RivetAPI) async throws -> StreamStart
    ) {
        self[keyPath: list].insert(card, at: 0)
        guard let api = apiRef else {
            card.fail("backend not ready")
            return
        }
        Task {
            do {
                let start = try await launch(api)
                card.requestId = start.request_id
                streamRegistry[start.request_id] = card
            } catch {
                card.fail(String(describing: error))
            }
        }
    }

    // translate ----------------------------------------------------------------

    func translateSelection() {
        guard let text = selectionText() else {
            prependNotice(L10n.t("ui.need.selection"), to: \.translateCards)
            return
        }
        translateSelectionText(text)
    }

    func translateSelectionText(_ text: String) {
        let lang = languageName(settings.target_language)
        startCardStream(
            card: StreamCard(
                title: L10n.t("ui.menu.translate"), meta: "→ \(lang)",
                sourceText: text),
            list: \.translateCards) { api in
            try await api.translate_text(text: text, target: self.settings.target_language)
        }
    }

    func translateCurrentPage() {
        guard ensureProvider(for: \.translateCards) else { return }
        guard let source = currentPageText() else {
            prependNotice(L10n.t("ui.need.document"), to: \.translateCards)
            return
        }
        let lang = languageName(settings.target_language)
        let payload = "以下是 PDF 第 \(source.page) 页提取的文本：\n\n\(source.text)"
        startCardStream(
            card: StreamCard(
                title: epubActive ? L10n.t("ui.epub.translate-title", "\(source.page)")
                                  : L10n.t("ui.translate.page-title", "\(source.page)"), meta: "→ \(lang)",
                sourceText: source.text),
            list: \.translateCards) { api in
            try await api.translate_text(text: payload, target: self.settings.target_language)
        }
    }

    // summarize ----------------------------------------------------------------

    private func summarize(title: String, meta: String, text: String, mode: SummarizeMode, list: ReferenceWritableKeyPath<PDFGistModel, [StreamCard]>) {
        guard ensureProvider(for: list) else { return }
        let lang = languageName(settings.target_language)
        startCardStream(
            card: StreamCard(title: title, meta: meta.isEmpty ? lang : "\(lang) · \(meta)", sourceText: text),
            list: list) { api in
            try await api.summarize_text(text: text, mode: mode)
        }
    }

    func summarizePage() {
        guard let source = currentPageText() else {
            prependNotice(L10n.t("ui.need.document"), to: \.summarizeCards)
            return
        }
        summarize(
            title: epubActive ? L10n.t("ui.epub.summarize-title", "\(source.page)")
                                  : L10n.t("ui.summarize.page-title", "\(source.page)"), meta: "",
            text: source.text, mode: .page, list: \.summarizeCards)
    }

    func summarizeSelection() {
        guard let text = selectionText() else {
            prependNotice(L10n.t("ui.need.selection"), to: \.summarizeCards)
            return
        }
        summarize(title: L10n.t("ui.summarize.selection"), meta: "", text: text, mode: .selection, list: \.summarizeCards)
    }

    func summarizeDoc() {
        guard let tab = activeTab, let source = docText(tab), !source.text.isEmpty else {
            prependNotice(L10n.t("ui.need.document"), to: \.summarizeCards)
            return
        }
        summarize(
            title: L10n.t("ui.summarize.doc"),
            meta: L10n.t("ui.summarize.doc-meta", "\(source.pages)"),
            text: source.text, mode: .doc, list: \.summarizeCards)
    }

    // chat ---------------------------------------------------------------------

    private func chatContext() -> (text: String, label: String)? {
        switch chatScope {
        case 1:
            guard let text = selectionText() else { return nil }
            return (text, "选区")
        case 2:
            guard let tab = activeTab, let source = docText(tab), !source.text.isEmpty else { return nil }
            return (source.text, "全文前 \(source.pages) 页")
        default:
            guard let tab = activeTab, let page = currentPageText() else { return nil }
            return ("第 \(page.page) 页：\n\(page.text)", "第 \(page.page) 页")
        }
    }

    private func appendAssistantText(_ text: String, dimmed: Bool = false) {
        chatBubbles.append(ChatBubble(isUser: false, text: text, dimmed: dimmed, card: nil))
    }

    func sendChat(_ rawQuestion: String) {
        let question = rawQuestion.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty, !chatBusy else { return }
        guard let context = chatContext() else {
            appendAssistantText(chatScope == 1
                ? L10n.t("ui.chat.need-selection") : L10n.t("ui.need.document"))
            return
        }
        if !settings.base_url.isEmpty && !settings.model.isEmpty
            && (settings.has_api_key || settings.provider == "ollama") {
            // ok
        } else {
            aiTab = .settings
            appendAssistantText(L10n.t("ui.settings.need-config"))
            return
        }
        chatBubbles.append(ChatBubble.user(question))
        let card = StreamCard(title: "chat", meta: languageName(settings.target_language))
        chatBubbles.append(ChatBubble(isUser: false, text: "", dimmed: false, card: card))
        chatLive = card
        chatPendingQuestion = question
        chatBusy = true
        guard let api = apiRef else {
            card.fail("backend not ready")
            finalizeChat(card)
            return
        }
        let history = Array(chatHistory.suffix(12))
        Task {
            do {
                let start = try await api.chat(
                    context_text: context.text, context_label: context.label,
                    history: history, user_message: question)
                card.requestId = start.request_id
                streamRegistry[start.request_id] = card
            } catch {
                card.fail(String(describing: error))
                finalizeChat(card)
            }
        }
    }

    private func finalizeChat(_ card: StreamCard) {
        chatBusy = false
        chatLive = nil
        let hasContent = !card.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if hasContent {
            chatHistory.append(["user", chatPendingQuestion])
            chatHistory.append(["assistant", card.content])
            // bubble keeps the finished card (markdown + dimmed reasoning)
            return
        }
        if !card.reasoning.isEmpty {
            // reasoning-only stream: keep the dimmed reasoning rendering
            return
        }
        guard let index = chatBubbles.lastIndex(where: { $0.card === card }) else { return }
        var bubble = chatBubbles[index]
        if case .empty(let stopped) = card.phase, stopped {
            bubble.text = L10n.t("backend.stream.stopped")
        } else {
            bubble.text = L10n.t("backend.stream.no-content")
        }
        bubble.card = nil
        bubble.dimmed = true
        chatBubbles[index] = bubble
    }

    func stopStream(_ card: StreamCard) {
        guard card.requestId > 0 else {
            card.finish(stopped: true)
            if chatLive === card { finalizeChat(card) }
            return
        }
        stoppingStreams.insert(card.requestId)
        Task { try? await apiRef?.stop_stream(request_id: card.requestId) }
    }

    func stopChat() {
        if let card = chatLive { stopStream(card) }
    }

    // MARK: find

    func runFind() {
        findTask?.cancel()
        let query = findQuery
        if epubActive, let epub = epubTab {
            runEpubFind(query, epub)
            return
        }
        guard let tab = activeTab, !query.isEmpty else {
            findTotal = 0
            findIndex = 0
            clearFindHighlights()
            return
        }
        findTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled else { return }
            await MainActor.run { self?.performFind(query: query, tab: tab) }
        }
    }

    private func performFind(query: String, tab: PDFTab) {
        guard let doc = tab.document else { return }
        let hits = doc.findString(query, withOptions: [.caseInsensitive])
        findHits = hits
        findTotal = hits.count
        tab.pdfView.highlightedSelections = hits.isEmpty ? nil : hits
        guard !hits.isEmpty else { return }
        let current = max(tab.currentPage - 1, 0)
        let pagesIndex = { (selection: PDFSelection) -> Int in
            guard let page = selection.pages.first else { return 0 }
            return doc.index(for: page)
        }
        findIndex = hits.firstIndex(where: { pagesIndex($0) >= current }) ?? 0
        tab.pdfView.go(to: hits[findIndex])
    }

    func findNext() { navigateFind(1) }

    func findPrevious() { navigateFind(-1) }

    /// Whole-book search over the prefetched chapter texts (v1 runSearch):
    /// case-insensitive, per-chapter ordinals, excerpt-free navigation.
    private func runEpubFind(_ query: String, _ epub: EpubTab) {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        epubFindHits = []
        epubFindQuery = needle
        guard !needle.isEmpty else {
            findTotal = 0
            findIndex = 0
            epub.clearHighlights()
            return
        }
        for i in 1...max(1, epub.chapters) {
            let text = (epub.textCache[i] ?? "").lowercased()
            var from = text.startIndex
            var ordinal = 0
            while let range = text.range(of: needle.lowercased(), range: from..<text.endIndex) {
                epubFindHits.append((i, ordinal))
                ordinal += 1
                from = range.upperBound
            }
        }
        findTotal = epubFindHits.count
        findIndex = epubFindHits.isEmpty ? 0 : 0
        if let first = epubFindHits.first {
            epub.highlightHit(chapter: first.chapter, ordinal: first.ordinal, query: needle)
        }
    }

    private func navigateFind(_ step: Int) {
        if epubActive, let epub = epubTab {
            guard !epubFindHits.isEmpty else { return }
            epubFindHitIndex = (epubFindHitIndex + step + epubFindHits.count) % epubFindHits.count
            let hit = epubFindHits[epubFindHitIndex]
            findIndex = epubFindHitIndex
            epub.highlightHit(chapter: hit.chapter, ordinal: hit.ordinal, query: epubFindQuery)
            return
        }
        guard let tab = activeTab, !findHits.isEmpty else { return }
        findIndex = (findIndex + step + findHits.count) % findHits.count
        tab.pdfView.go(to: findHits[findIndex])
    }

    func closeFind() {
        findVisible = false
        findQuery = ""
        findTotal = 0
        epubFindHits = []
        epubFindHitIndex = 0
        epubTab?.clearHighlights()
        clearFindHighlights()
    }

    private func clearFindHighlights() {
        findHits = []
        activeTab?.pdfView.highlightedSelections = nil
    }

    // MARK: settings actions

    func saveApiKey(_ key: String) async -> String {
        guard let api = apiRef else { return "backend not ready" }
        do {
            try await api.save_api_key(key: key)
            settings = try await api.get_settings()
            return L10n.t("ui.settings.saved")
        } catch {
            return L10n.t("ui.settings.save-failed", String(describing: error))
        }
    }

    func testConnection(baseURL: String, apiKey: String, model: String) async -> (message: String, models: [String]) {
        guard let api = apiRef else { return ("backend not ready", []) }
        do {
            let result = try await api.test_connection(base_url: baseURL, api_key: apiKey, model: model)
            if result.ok {
                let models = result.models ?? []
                let message = models.isEmpty
                    ? L10n.t("ui.settings.test-ok-no-list")
                    : L10n.t("ui.settings.test-ok", "\(models.count)")
                return (message, models)
            }
            return (result.error ?? "unknown error", [])
        } catch {
            return (String(describing: error), [])
        }
    }

    func saveSettings(
        provider: String, baseURL: String, model: String,
        target: TargetLanguage, viewMode: String, sidecar: Bool
    ) async -> String {
        guard let api = apiRef else { return "backend not ready" }
        let update = SettingsUpdate(
            provider: provider, base_url: baseURL, model: model,
            target_language: target, view_mode: viewMode, annotation_sidecar: sidecar)
        do {
            let saved = try await api.save_settings(update: update)
            settings = saved
            let double = viewMode == "double"
            for tab in tabs { tab.setDisplayMode(double: double) }
            return L10n.t("ui.settings.saved")
        } catch {
            return L10n.t("ui.settings.save-failed", String(describing: error))
        }
    }
}
