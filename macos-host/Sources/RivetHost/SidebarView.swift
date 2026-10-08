import SwiftUI
import AppKit

/// Right AI sidebar: 翻译 / 总结 / 对话 / 批注 / 表单 / 设置 — the six v1 tabs.
struct AISidebar: View {
    @EnvironmentObject private var model: PDFGistModel

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: Binding(
                get: { model.aiTab },
                set: { model.aiTab = $0 })) {
                ForEach(AITab.allCases) { tab in
                    Text(tabTitle(tab)).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(8)
            pane
        }
        .background(Theme.bg)
    }

    private func tabTitle(_ tab: AITab) -> String {
        switch tab {
        case .translate: return L10n.t("ui.tab.translate")
        case .summarize: return L10n.t("ui.tab.summarize")
        case .chat: return L10n.t("ui.tab.chat")
        case .notes: return L10n.t("ui.tab.notes")
        case .forms: return L10n.t("ui.tab.forms")
        case .settings: return L10n.t("ui.tab.settings")
        }
    }

    @ViewBuilder
    private var pane: some View {
        switch model.aiTab {
        case .translate:
            CardListPane(actionTitle: model.epubActive ? L10n.t("ui.epub.translate-page") : L10n.t("ui.translate.page"), action: { model.translateCurrentPage() },
                         cards: model.translateCards,
                         emptyHint: L10n.t("ui.welcome.feature1"))
        case .summarize:
            SummarizePane()
        case .chat:
            ChatPane()
        case .notes:
            if let tab = model.activeTab {
                NotesPane(tab: tab)
            } else {
                EmptyHint(L10n.t("ui.need.document"))
            }
        case .forms:
            if let tab = model.activeTab {
                FormsPane(tab: tab)
            } else {
                EmptyHint(L10n.t("ui.need.document"))
            }
        case .settings:
            SettingsPane()
        }
    }
}

// MARK: - translate / summarize card lists

struct CardListPane: View {
    @EnvironmentObject private var model: PDFGistModel
    let actionTitle: String
    let action: () -> Void
    let cards: [StreamCard]
    let emptyHint: String

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button {
                    action()
                } label: {
                    Label(actionTitle, systemImage: "globe")
                        .font(.system(size: 12))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.accent)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(RoundedRectangle(cornerRadius: 5).fill(Theme.accentSoft))
                .overlay(RoundedRectangle(cornerRadius: 5).stroke(Theme.accentBorder))
                Spacer()
            }
            .padding(8)
            cardList
        }
    }

    @ViewBuilder
    private var cardList: some View {
        if cards.isEmpty {
            EmptyHint(emptyHint)
        } else {
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(cards) { card in
                        StreamCardView(card: card)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 12)
            }
        }
    }
}

struct EmptyHint: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        VStack {
            Spacer()
            Text(text)
                .font(.system(size: 12))
                .foregroundStyle(Theme.textFaint)
                .multilineTextAlignment(.center)
                .padding(20)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct SummarizePane: View {
    @EnvironmentObject private var model: PDFGistModel

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                pillButton(model.epubActive ? L10n.t("ui.epub.summarize-page") : L10n.t("ui.summarize.page")) { model.summarizePage() }
                pillButton(L10n.t("ui.summarize.selection")) { model.summarizeSelection() }
                pillButton(L10n.t("ui.summarize.doc")) { model.summarizeDoc() }
                Spacer()
            }
            .padding(8)
            if model.summarizeCards.isEmpty {
                EmptyHint(L10n.t("ui.welcome.feature1"))
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(model.summarizeCards) { card in
                            StreamCardView(card: card)
                        }
                    }
                    .padding(.horizontal, 8)
                    .padding(.bottom, 12)
                }
            }
        }
    }

    private func pillButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12))
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.accent)
        .background(RoundedRectangle(cornerRadius: 5).fill(Theme.accentSoft))
        .overlay(RoundedRectangle(cornerRadius: 5).stroke(Theme.accentBorder))
    }
}

// MARK: - chat

struct ChatPane: View {
    @EnvironmentObject private var model: PDFGistModel
    @State private var draft = ""

    var body: some View {
        VStack(spacing: 0) {
            scopeRow
            messageList
            inputRow
        }
    }

    private var scopeRow: some View {
        HStack(spacing: 6) {
            Text(L10n.t("ui.chat.scope"))
                .font(.system(size: 11))
                .foregroundStyle(Theme.textFaint)
            Picker("", selection: Binding(
                get: { model.chatScope },
                set: { model.chatScope = $0 })) {
                Text(model.epubActive ? L10n.t("ui.epub.scope-page") : L10n.t("ui.chat.scope.page")).tag(0)
                Text(L10n.t("ui.chat.scope.selection")).tag(1)
                Text(L10n.t("ui.chat.scope.doc")).tag(2)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .controlSize(.small)
            Spacer()
        }
        .padding(.horizontal, 8)
        .padding(.bottom, 6)
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    if model.chatBubbles.isEmpty {
                        EmptyHint(L10n.t("ui.chat.placeholder"))
                            .frame(height: 200)
                    }
                    ForEach(model.chatBubbles) { bubble in
                        ChatBubbleView(bubble: bubble)
                            .id(bubble.id)
                    }
                }
                .padding(.horizontal, 8)
            }
            .onChange(of: model.chatBubbles.count) { _ in
                if let last = model.chatBubbles.last {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
    }

    private var inputRow: some View {
        HStack(alignment: .bottom, spacing: 6) {
            TextField(L10n.t("ui.chat.placeholder"), text: $draft, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...4)
                .font(.system(size: 13))
                .onSubmit { send() }
            if model.chatBusy {
                Button {
                    model.stopChat()
                } label: {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 12))
                        .frame(width: 26, height: 26)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.danger)
                .help(L10n.t("ui.chat.stop"))
            } else {
                Button {
                    send()
                } label: {
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 12))
                        .frame(width: 26, height: 26)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.white)
                .background(Circle().fill(draft.trimmingCharacters(in: .whitespaces).isEmpty ? Theme.textFaint : Theme.accent))
                .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(8)
    }

    private func send() {
        let question = draft
        guard !question.trimmingCharacters(in: .whitespaces).isEmpty, !model.chatBusy else { return }
        draft = ""
        model.sendChat(question)
    }
}

struct ChatBubbleView: View {
    let bubble: ChatBubble

    var body: some View {
        HStack {
            if bubble.isUser {
                Spacer(minLength: 40)
                Text(bubble.text)
                    .font(.system(size: 13))
                    .textSelection(.enabled)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Theme.accent.opacity(0.16)))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.accentBorder))
            } else if let card = bubble.card {
                StreamCardView(card: card)
            } else {
                Text(bubble.text)
                    .font(.system(size: 13))
                    .foregroundStyle(bubble.dimmed ? Theme.textFaint : Theme.text)
                    .italic(bubble.dimmed)
                    .textSelection(.enabled)
                Spacer(minLength: 40)
            }
        }
        .frame(maxWidth: .infinity, alignment: bubble.isUser ? .trailing : .leading)
    }
}

// MARK: - notes (annotations + bookmarks)

struct NotesPane: View {
    @EnvironmentObject private var model: PDFGistModel
    @ObservedObject var tab: PDFTab

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    if tab.docData.annotations.isEmpty {
                        Text(L10n.t("ui.notes.empty"))
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textFaint)
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.panel))
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.border))
                    }
                    ForEach(sortedAnnotations) { annotation in
                        NoteCard(annotation: annotation)
                    }
                    bookmarkSection
                }
                .padding(8)
            }
        }
    }

    private var sortedAnnotations: [StoredAnnotation] {
        tab.docData.annotations.sorted {
            $0.page == $1.page ? $0.created < $1.created : $0.page < $1.page
        }
    }

    @ViewBuilder
    private var bookmarkSection: some View {
        Text(L10n.t("ui.notes.bookmarks"))
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Theme.textDim)
            .padding(.top, 6)
        if tab.docData.bookmarks.isEmpty {
            Text(L10n.t("ui.notes.bookmark-empty"))
                .font(.system(size: 11))
                .foregroundStyle(Theme.textFaint)
                .padding(.vertical, 2)
        }
        ForEach(tab.docData.bookmarks.sorted { $0.page < $1.page }) { bookmark in
            HStack(spacing: 6) {
                Text("\(bookmark.page)")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                    .frame(width: 22)
                Text(bookmark.label.isEmpty ? L10n.t("ui.notes.page", "\(bookmark.page)") : bookmark.label)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Spacer()
                Button {
                    model.removeBookmark(bookmark.page)
                } label: {
                    Text(L10n.t("ui.notes.delete-btn"))
                        .font(.system(size: 10))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.textFaint)
                .help(L10n.t("ui.notes.bookmark-remove"))
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 6).fill(Theme.panel))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.border))
            .contentShape(Rectangle())
            .onTapGesture { tab.goToPage(bookmark.page) }
        }
    }
}

struct NoteCard: View {
    @EnvironmentObject private var model: PDFGistModel
    let annotation: StoredAnnotation

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Circle()
                    .fill(Theme.annotationSwiftUIColor(annotation.color))
                    .frame(width: 9, height: 9)
                Text(L10n.t("ui.notes.page", "\(annotation.page)"))
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Theme.textDim)
                if annotation.kind != "highlight" {
                    Text(annotation.kind)
                        .font(.system(size: 9))
                        .foregroundStyle(Theme.textFaint)
                }
                Spacer()
                Button {
                    model.translateSelectionText(annotation.excerpt)
                } label: {
                    Text(L10n.t("ui.notes.translate-btn"))
                        .font(.system(size: 10))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.accent)
                .help(L10n.t("ui.menu.translate"))
                Button {
                    model.removeAnnotation(annotation.id)
                } label: {
                    Text(L10n.t("ui.notes.delete-btn"))
                        .font(.system(size: 10))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.textFaint)
                .help(L10n.t("ui.notes.delete-btn"))
            }
            Text(annotation.excerpt)
                .font(.system(size: 12))
                .foregroundStyle(Theme.text)
                .lineLimit(4)
                .textSelection(.enabled)
            if !annotation.note.isEmpty {
                Text(annotation.note)
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textDim)
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Theme.panel))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.border))
        .contentShape(Rectangle())
        .onTapGesture {
            model.activeTab?.goToPage(annotation.page)
        }
    }
}
