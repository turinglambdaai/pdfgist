import SwiftUI
import AppKit
import PDFKit
import UniformTypeIdentifiers

struct ContentView: View {
    @EnvironmentObject private var model: PDFGistModel

    var body: some View {
        VStack(spacing: 0) {
            if !model.status.isEmpty && !model.ready {
                backendBanner
            }
            ToolbarRow()
            HStack(spacing: 0) {
                if model.leftPanelVisible {
                    LeftPanel()
                        .frame(width: model.leftWidth)
                    PanelDivider(
                        width: Binding(get: { model.leftWidth }, set: { model.leftWidth = $0 }),
                        range: 160...440, inverted: false)
                }
                CenterPane()
                if model.aiVisible {
                    PanelDivider(
                        width: Binding(get: { model.aiWidth }, set: { model.aiWidth = $0 }),
                        range: 280...680, inverted: true)
                    AISidebar()
                        .frame(width: model.aiWidth)
                }
            }
            if model.activeTab != nil {
                BottomBar()
            }
        }
        .background(Theme.bg)
        .foregroundStyle(Theme.text)
        .preferredColorScheme(model.resolvedColorScheme)
        .onAppear { model.persistPanelWidths() }
        .dropDestination(for: URL.self) { urls, _ in
            model.openDropped(urls)
            return true
        }
        .alert(model.alertText, isPresented: Binding(
            get: { model.showAlert }, set: { model.showAlert = $0 })) {}
        .sheet(item: Binding(
            get: { model.passwordPrompt },
            set: { _ in model.cancelPassword() })) { prompt in
            PasswordSheet(wrong: prompt.wrong)
                .interactiveDismissDisabled()
        }
        .sheet(isPresented: $model.showUpdateSheet) {
            UpdateView()
        }
        .task { model.start() }
    }

    private var backendBanner: some View {
        Text(model.status)
            .font(.footnote)
            .foregroundStyle(Theme.danger)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)
            .background(Theme.accentSoft)
    }
}

// MARK: - toolbar

struct ToolbarRow: View {
    @EnvironmentObject private var model: PDFGistModel

    var body: some View {
        HStack(spacing: 8) {
            toolbarButton(L10n.t("ui.toolbar.open"), icon: "folder") {
                model.pickAndOpen()
            }
            toolbarIcon("sidebar.left", active: model.leftPanelVisible) {
                model.leftPanelVisible.toggle()
            }
            tabStrip
            toolbarIcon("plus", active: false) {
                model.pickAndOpen()
            }
            Spacer(minLength: 8)
            toolbarIcon("magnifyingglass", active: model.findVisible) {
                if model.findVisible {
                    model.closeFind()
                } else if model.activeTab != nil {
                    model.findVisible = true
                }
            }
            .disabled(model.activeTab == nil)
            toolbarIcon(
                model.activeTab?.isBookmarked == true ? "bookmark.fill" : "bookmark",
                active: model.activeTab?.isBookmarked == true) {
                model.toggleBookmark()
            }
            .disabled(model.activeTab == nil)
            toolbarIcon("printer", active: false) {
                model.printActive()
            }
            .disabled(model.activeTab == nil)
            toolbarIcon("speaker.wave.2", active: model.ttsSpeaking) {
                model.toggleTTS()
            }
            .disabled(model.activeTab == nil)
            if let tab = model.activeTab {
                SplitToggle(tab: tab)
            } else {
                toolbarIcon("rectangle.split.2x1", active: false) {}
                    .disabled(true)
            }
            toolbarIcon("sparkles", active: model.aiVisible) {
                model.aiVisible.toggle()
            }
            toolbarIcon(
                model.resolvedColorScheme == .dark ? "moon" : "sun.max", active: false) {
                model.toggleTheme()
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Theme.panel)
        .overlay(alignment: .bottom) { Divider().overlay(Theme.border) }
    }

    @ViewBuilder
    private var tabStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(model.tabs) { tab in
                    TabChip(tab: tab)
                }
                if let epub = model.epubTab {
                    EpubTabChip(tab: epub)
                }
            }
        }
    }

    private func toolbarButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .labelStyle(.titleAndIcon)
                .font(.system(size: 12))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.text)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(RoundedRectangle(cornerRadius: 5).fill(Theme.panelAlt))
        .overlay(RoundedRectangle(cornerRadius: 5).stroke(Theme.border))
    }

    private func toolbarIcon(_ icon: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 13))
                .frame(width: 26, height: 24)
        }
        .buttonStyle(.plain)
        .foregroundStyle(active ? Theme.accent : Theme.textDim)
        .background(
            RoundedRectangle(cornerRadius: 5)
                .fill(active ? Theme.accentSoft : Color.clear))
    }
}

struct EpubTabChip: View {
    @EnvironmentObject private var model: PDFGistModel
    @ObservedObject var tab: EpubTab

    var body: some View {
        let active = model.epubActive
        HStack(spacing: 4) {
            Image(systemName: "book")
                .font(.system(size: 10))
                .foregroundStyle(active ? Theme.accent : Theme.textFaint)
            Text(tab.title)
                .font(.system(size: 12))
                .lineLimit(1)
                .frame(maxWidth: 150)
                .truncationMode(.middle)
            Button {
                model.closeEpub()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(active ? Theme.textDim : Theme.textFaint)
                    .frame(width: 14, height: 14)
            }
            .buttonStyle(.plain)
            .help(L10n.t("ui.toolbar.tab-close"))
        }
        .contentShape(Rectangle())
        .onTapGesture { model.activateEpub() }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 5)
                .fill(active ? Theme.accentSoft : Theme.panelAlt))
        .overlay(
            RoundedRectangle(cornerRadius: 5)
                .stroke(active ? Theme.accentBorder : Theme.border))
    }
}

struct TabChip: View {
    @EnvironmentObject private var model: PDFGistModel
    let tab: PDFTab

    var body: some View {
        let active = tab.id == model.activeTabID
        HStack(spacing: 4) {
            Text(tab.title)
                .font(.system(size: 12))
                .lineLimit(1)
                .frame(maxWidth: 150)
                .truncationMode(.middle)
            Button {
                model.closeTab(tab.id)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(active ? Theme.textDim : Theme.textFaint)
                    .frame(width: 14, height: 14)
            }
            .buttonStyle(.plain)
            .help(L10n.t("ui.toolbar.tab-close"))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 5)
                .fill(active ? Theme.accentSoft : Theme.panelAlt))
        .overlay(
            RoundedRectangle(cornerRadius: 5)
                .stroke(active ? Theme.accentBorder : Theme.border))
        .foregroundStyle(active ? Theme.accent : Theme.textDim)
        .contentShape(Rectangle())
        .onTapGesture { model.activateTab(tab.id) }
    }
}

// MARK: - panel divider

struct PanelDivider: View {
    @EnvironmentObject private var model: PDFGistModel
    @Binding var width: CGFloat
    let range: ClosedRange<CGFloat>
    let inverted: Bool
    @State private var dragging = false

    var body: some View {
        Rectangle()
            .fill(dragging ? Theme.accent : Theme.border)
            .frame(width: 4)
            .contentShape(Rectangle())
            .onHover { hovering in
                if hovering { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
            }
            .gesture(
                DragGesture(minimumDistance: 1)
                    .onChanged { value in
                        dragging = true
                        let delta = inverted ? -value.translation.width : value.translation.width
                        width = min(max(width + delta, range.lowerBound), range.upperBound)
                    }
                    .onEnded { _ in
                        dragging = false
                        model.persistPanelWidths()
                    })
    }
}

// MARK: - page ops (v1 editor.ts buttons; ops target the current page —
// v1 used thumbnail checkboxes, this build narrows to the current page)

struct PageOpsBar: View {
    @ObservedObject var tab: PDFTab
    @EnvironmentObject private var model: PDFGistModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(L10n.t("ui.pages.title"))
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.textDim)
            HStack(spacing: 6) {
                opButton(L10n.t("ui.pages.rotate")) { model.runPageEdit(.rotateCurrent) }
                opButton(L10n.t("ui.pages.blank")) { model.runPageEdit(.insertBlankAfterCurrent) }
                opButton(L10n.t("ui.pages.delete")) { model.runPageEdit(.deleteCurrent) }
            }
            HStack(spacing: 6) {
                opButton(L10n.t("ui.pages.extract")) {
                    model.runPageEdit(.extract(pages: [Int64(tab.currentPage)]))
                }
                opButton(L10n.t("ui.pages.merge")) {
                    let panel = NSOpenPanel()
                    panel.allowedContentTypes = [.pdf]
                    panel.canChooseFiles = true
                    if panel.runModal() == .OK, let url = panel.url {
                        model.runPageEdit(.merge(path: url.path))
                    }
                }
            }
            Text(L10n.t("ui.pages.current-hint", "\(tab.currentPage)"))
                .font(.system(size: 10))
                .foregroundStyle(Theme.textFaint)
        }
        .padding(.horizontal, 10)
        .padding(.top, 4)
        .padding(.bottom, 8)
    }

    private func opButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 11))
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.text)
        .background(RoundedRectangle(cornerRadius: 5).fill(Theme.panelAlt))
        .overlay(RoundedRectangle(cornerRadius: 5).stroke(Theme.border))
    }
}

// MARK: - left panel (recents / thumbnails / outline)

struct LeftPanel: View {
    @EnvironmentObject private var model: PDFGistModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            recentsSection
            Picker("", selection: Binding(
                get: { model.leftPanelMode },
                set: { model.leftPanelMode = $0 })) {
                Text(L10n.t("ui.viewer.thumbs")).tag(0)
                Text(L10n.t("ui.viewer.outline")).tag(1)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(8)
            panelContent
        }
        .background(Theme.panel)
    }

    @ViewBuilder
    private var recentsSection: some View {
        if !model.recents.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Text(L10n.t("ui.viewer.recents"))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.textDim)
                    .padding(.horizontal, 10)
                    .padding(.top, 8)
                ForEach(Array(model.recents.prefix(5).enumerated()), id: \.element.path) { _, recent in
                    RecentRow(recent: recent)
                }
            }
            .padding(.bottom, 4)
        }
    }

    @ViewBuilder
    private var panelContent: some View {
        if model.epubActive, let epub = model.epubTab {
            if model.leftPanelMode == 1 {
                EpubTocList(tab: epub)
            } else {
                EpubTocList(tab: epub)
            }
        } else if model.activeTab == nil {
            emptyHint
        } else if model.leftPanelMode == 0 {
            VStack(spacing: 0) {
                ThumbnailStrip(tab: model.activeTab!)
                    .frame(height: 140)
                    .padding(.horizontal, 6)
                PageOpsBar(tab: model.activeTab!)
            }
            Spacer()
        } else {
            OutlineList(tab: model.activeTab!)
        }
    }

    private var emptyHint: some View {
        VStack {
            Spacer()
            Text(L10n.t("ui.welcome.open"))
                .font(.footnote)
                .foregroundStyle(Theme.textFaint)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

struct RecentRow: View {
    @EnvironmentObject private var model: PDFGistModel
    let recent: RivetTypes.RecentEntry

    var body: some View {
        Button {
            model.openRecent(recent)
        } label: {
            HStack(spacing: 6) {
                Text("\(recent.page)")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                    .frame(width: 22)
                Text((recent.path as NSString).lastPathComponent)
                    .font(.system(size: 11))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .foregroundStyle(Theme.text)
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .help(recent.path)
    }
}

struct OutlineList: View {
    @EnvironmentObject private var model: PDFGistModel
    let tab: PDFTab

    var body: some View {
        if tab.outline.isEmpty {
            VStack {
                Spacer()
                Text(L10n.t("ui.viewer.outline-empty"))
                    .font(.footnote)
                    .foregroundStyle(Theme.textFaint)
                Spacer()
            }
            .frame(maxWidth: .infinity)
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(tab.outline) { node in
                        OutlineRow(node: node, depth: 0)
                    }
                }
                .padding(.horizontal, 8)
            }
        }
    }
}

struct OutlineRow: View {
    @EnvironmentObject private var model: PDFGistModel
    let node: OutlineNode
    let depth: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !node.label.isEmpty {
                Text(node.label)
                    .font(.system(size: 12))
                    .lineLimit(1)
                    .foregroundStyle(Theme.text)
                    .padding(.leading, CGFloat(8 + depth * 14))
                    .padding(.vertical, 3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                    .onTapGesture { model.goToOutline(node) }
            }
            ForEach(node.children) { child in
                OutlineRow(node: child, depth: depth + 1)
            }
        }
    }
}

// MARK: - center pane

struct CenterPane: View {
    @EnvironmentObject private var model: PDFGistModel

    var body: some View {
        if model.epubActive, let epub = model.epubTab {
            EpubViewport(tab: epub)
        } else if let tab = model.activeTab {
            CenteredDocument(tab: tab)
        } else {
            WelcomeView()
        }
    }
}

/// Document area. Observes the tab directly so tab-level state (splitOn)
/// re-renders it — the environment model alone does not.
private struct CenteredDocument: View {
    @ObservedObject var tab: PDFTab
    @EnvironmentObject private var model: PDFGistModel

    var body: some View {
        ZStack(alignment: .top) {
            HStack(alignment: .top, spacing: 0) {
                PDFViewport(tab: tab)
                    .ignoresSafeArea()
                    .background(Theme.bg)
                if tab.splitOn {
                    Divider().overlay(Theme.border)
                    SplitViewport(tab: tab)
                        .ignoresSafeArea()
                        .background(Theme.panelAlt)
                }
            }
            if model.findVisible {
                FindBarView()
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - find bar

struct FindBarView: View {
    @EnvironmentObject private var model: PDFGistModel

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Theme.textDim)
            TextField(L10n.t("ui.viewer.find-placeholder"), text: Binding(
                get: { model.findQuery },
                set: { model.findQuery = $0; model.runFind() }))
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .frame(width: 180)
                .onSubmit { model.findNext() }
            if model.findTotal > 0 {
                Text("\(model.findIndex + 1)/\(model.findTotal)")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textDim)
            } else if !model.findQuery.isEmpty {
                Text("0")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textFaint)
            }
            Button {
                model.findPrevious()
            } label: {
                Image(systemName: "chevron.up")
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.textDim)
            Button {
                model.findNext()
            } label: {
                Image(systemName: "chevron.down")
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.textDim)
            Button {
                model.closeFind()
            } label: {
                Image(systemName: "xmark")
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.textDim)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 8).fill(Theme.panel))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.borderStrong))
        .shadow(color: Color.black.opacity(0.18), radius: 8, y: 2)
    }
}

// MARK: - welcome / empty state

/// Split-view toolbar toggle. Observes the tab so the active state tracks
/// tab.splitOn (the environment model does not republish tab-level changes).
private struct SplitToggle: View {
    @ObservedObject var tab: PDFTab

    var body: some View {
        Button {
            tab.splitOn.toggle()
        } label: {
            Image(systemName: "rectangle.split.2x1")
                .font(.system(size: 13))
                .frame(width: 26, height: 24)
        }
        .buttonStyle(.plain)
        .foregroundStyle(tab.splitOn ? Theme.accent : Theme.textDim)
        .background(
            RoundedRectangle(cornerRadius: 5)
                .fill(tab.splitOn ? Theme.accentSoft : Color.clear))
    }
}

/// EPUB table of contents (domain-provided spine mapping).
struct EpubTocList: View {
    @EnvironmentObject private var model: PDFGistModel
    @ObservedObject var tab: EpubTab

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 1) {
                if tab.toc.isEmpty {
                    Text(L10n.t("ui.epub.toc-empty"))
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textFaint)
                        .padding(10)
                }
                ForEach(Array(tab.toc.enumerated()), id: \.offset) { _, item in
                    Button {
                        tab.goToChapter(Int(item.chapter))
                    } label: {
                        Text(item.title)
                            .font(.system(size: 12))
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.leading, CGFloat(10 + item.level * 12))
                            .padding(.vertical, 4)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(
                        tab.currentPage == Int(item.chapter) ? Theme.accent : Theme.text)
                }
                if tab.toc.isEmpty {
                    ForEach(1...max(1, tab.chapters), id: \.self) { i in
                        Button {
                            tab.goToChapter(i)
                        } label: {
                            Text(L10n.t("ui.epub.chapter-n", "\(i)"))
                                .font(.system(size: 12))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.leading, 10)
                                .padding(.vertical, 4)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(
                            tab.currentPage == i ? Theme.accent : Theme.text)
                    }
                }
            }
            .padding(.horizontal, 6)
            .padding(.top, 4)
        }
    }
}

struct WelcomeView: View {
    @EnvironmentObject private var model: PDFGistModel

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                brandMark
                Text("PDFGist")
                    .font(.system(size: 30, weight: .bold))
                Text(L10n.t("ui.welcome.tagline"))
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textDim)
                featureRow("sparkles", L10n.t("ui.welcome.feature1"))
                featureRow("magnifyingglass", L10n.t("ui.welcome.feature2"))
                featureRow("key", L10n.t("ui.welcome.feature3"))
                openButton
                Text(L10n.t("ui.welcome.or-drag"))
                    .font(.footnote)
                    .foregroundStyle(Theme.textFaint)
                continueSection
                Text(L10n.t("ui.welcome.hints"))
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textFaint)
            }
            .frame(maxWidth: 460)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg)
    }

    private var brandMark: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14)
                .fill(Theme.accent)
                .frame(width: 72, height: 72)
            Image(systemName: "doc.richtext.fill")
                .font(.system(size: 34))
                .foregroundStyle(Color.white)
        }
    }

    private func featureRow(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 12))
                .foregroundStyle(Theme.accent)
                .frame(width: 16)
            Text(text)
                .font(.system(size: 12))
                .foregroundStyle(Theme.textDim)
        }
    }

    private var openButton: some View {
        Button {
            model.pickAndOpen()
        } label: {
            Text(L10n.t("ui.welcome.open"))
                .font(.system(size: 14, weight: .semibold))
                .padding(.horizontal, 22)
                .padding(.vertical, 9)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.white)
        .background(RoundedRectangle(cornerRadius: 7).fill(Theme.accent))
        .disabled(!model.ready)
    }

    @ViewBuilder
    private var continueSection: some View {
        if !model.recents.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text(L10n.t("ui.welcome.continue"))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textDim)
                ForEach(Array(model.recents.prefix(6).enumerated()), id: \.element.path) { _, recent in
                    WelcomeRecentRow(recent: recent)
                }
            }
            .padding(.top, 10)
        }
    }
}

struct WelcomeRecentRow: View {
    @EnvironmentObject private var model: PDFGistModel
    let recent: RivetTypes.RecentEntry

    var body: some View {
        Button {
            model.openRecent(recent)
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text((recent.path as NSString).lastPathComponent)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Text(recentMeta)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textFaint)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 10))
                    .foregroundStyle(Theme.textFaint)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 6).fill(Theme.panel))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.border))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(recent.path)
    }

    private var recentMeta: String {
        let date = Date(timeIntervalSince1970: Double(recent.last_read_ms) / 1000)
        let calendar = Calendar.current
        return L10n.t(
            "ui.welcome.recent-meta", "\(recent.page)",
            "\(calendar.component(.month, from: date))",
            "\(calendar.component(.day, from: date))")
    }
}

// MARK: - bottom bar

struct BottomBar: View {
    @EnvironmentObject private var model: PDFGistModel
    @State private var pageInput = "1"

    var body: some View {
        if let tab = model.activeTab {
            HStack(spacing: 10) {
                TextField("", text: $pageInput)
                    .textFieldStyle(.roundedBorder)
                    .multilineTextAlignment(.center)
                    .frame(width: 44)
                    .font(.system(size: 12))
                    .onSubmit { jump(tab) }
                Text("/ \(tab.pageCount)")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textDim)
                Text(L10n.t("ui.viewer.pdf-info", "\(tab.pageCount)"))
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textFaint)
                Spacer()
                bottomIcon("minus.magnifyingglass") { tab.zoomOut() }
                Button {
                    tab.zoomReset()
                } label: {
                    Text("\(tab.scalePercent)%")
                        .font(.system(size: 12))
                        .frame(minWidth: 40)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.textDim)
                bottomIcon("plus.magnifyingglass") { tab.zoomIn() }
                bottomButton(L10n.t("ui.viewer.fit")) { tab.fitWidth() }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Theme.panel)
            .overlay(alignment: .top) { Divider().overlay(Theme.border) }
            .onChange(of: tab.currentPage) { page in
                pageInput = "\(page)"
            }
            .onAppear { pageInput = "\(tab.currentPage)" }
            .id(tab.id)
        }
    }

    private func bottomButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 12))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.textDim)
    }

    private func bottomIcon(_ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 11))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.textDim)
    }

    private func jump(_ tab: PDFTab) {
        guard let page = Int(pageInput), page >= 1, page <= tab.pageCount else {
            pageInput = "\(tab.currentPage)"
            return
        }
        tab.goToPage(page)
    }
}

// MARK: - password sheet

struct PasswordSheet: View {
    @EnvironmentObject private var model: PDFGistModel
    let wrong: Bool
    @State private var password = ""

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "lock")
                .font(.system(size: 26))
                .foregroundStyle(Theme.accent)
            Text(L10n.t("ui.password.title"))
                .font(.system(size: 14, weight: .semibold))
            if wrong {
                Text(L10n.t("ui.password.wrong"))
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.danger)
            }
            SecureField("", text: $password)
                .textFieldStyle(.roundedBorder)
                .frame(width: 240)
                .onSubmit { submit() }
            HStack(spacing: 10) {
                Button(L10n.t("ui.password.cancel")) { model.cancelPassword() }
                    .keyboardShortcut(.cancelAction)
                Button(L10n.t("ui.password.ok")) { submit() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(password.isEmpty)
            }
        }
        .padding(24)
        .frame(width: 320)
    }

    private func submit() {
        guard !password.isEmpty else { return }
        model.submitPassword(password)
        password = ""
    }
}
