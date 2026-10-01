import SwiftUI
import AppKit
import PDFKit

// MARK: - forms (AcroForm fill + export) — the v1 FORM tab.
// Form filling is a view-layer concern in v1 too (PDF.js annotationStorage +
// pdf-lib export): values live in the open document only and are never
// persisted, so this stays host-side and bypasses the RPC backend.

struct FormFieldInfo: Identifiable {
    let name: String
    let kind: Kind
    var id: String { name }
    let index: Int

    enum Kind { case text, check, choice }

    var typeLabel: String {
        switch kind {
        case .text: return L10n.t("ui.forms.type-text")
        case .check: return L10n.t("ui.forms.type-check")
        case .choice: return L10n.t("ui.forms.type-choice")
        }
    }
}

struct FormsPane: View {
    @ObservedObject var tab: PDFTab

    @State private var fields: [FormFieldInfo] = []
    @State private var widgetMap: [String: [PDFAnnotation]] = [:]
    @State private var textValues: [String: String] = [:]
    @State private var choiceValues: [String: String] = [:]
    @State private var checkValues: [String: Bool] = [:]
    @State private var status = ""
    @State private var statusIsError = false
    @State private var exportBusy = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button {
                    exportFilledPdf()
                } label: {
                    Label(L10n.t("ui.forms.export"), systemImage: "square.and.arrow.down")
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
            fieldList
            if !status.isEmpty {
                Text(status)
                    .font(.system(size: 11))
                    .foregroundStyle(statusIsError ? Theme.danger : Theme.textDim)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 12)
            }
        }
        .onAppear(perform: collectFields)
    }

    // MARK: field rows

    @ViewBuilder
    private var fieldList: some View {
        if fields.isEmpty {
            EmptyHint(statusIsError ? status : L10n.t("ui.forms.empty"))
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(fields) { field in
                        fieldRow(field)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 12)
            }
        }
    }

    private func fieldRow(_ field: FormFieldInfo) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Text(field.typeLabel)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(RoundedRectangle(cornerRadius: 4).fill(Theme.accentSoft))
                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(Theme.accentBorder))
                Text(field.name)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
            }
            control(for: field)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Theme.panel))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.border))
    }

    @ViewBuilder
    private func control(for field: FormFieldInfo) -> some View {
        switch field.kind {
        case .check:
            Toggle(L10n.t("ui.forms.type-check"), isOn: Binding(
                get: { checkValues[field.name] ?? false },
                set: { checkValues[field.name] = $0; applyCheck(field.name, $0) }))
                .toggleStyle(.checkbox)
                .font(.system(size: 12))
                .foregroundStyle(Theme.textDim)
        case .choice:
            TextField(L10n.t("ui.forms.choice-placeholder"), text: Binding(
                get: { choiceValues[field.name] ?? "" },
                set: { choiceValues[field.name] = $0; applyChoice(field.name, $0) }))
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 12))
        case .text:
            TextField("", text: Binding(
                get: { textValues[field.name] ?? "" },
                set: { textValues[field.name] = $0; applyText(field.name, $0) }))
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 12))
        }
    }

    // MARK: collect / apply

    private func collectFields() {
        var collected: [FormFieldInfo] = []
        var widgets: [String: [PDFAnnotation]] = [:]
        var texts: [String: String] = [:]
        var choices: [String: String] = [:]
        var checks: [String: Bool] = [:]
        guard let doc = tab.document else {
            fields = []
            setStatus(L10n.t("ui.forms.empty"))
            return
        }
        for pageIndex in 0..<doc.pageCount {
            guard let page = doc.page(at: pageIndex) else { continue }
            for anno in page.annotations {
                let kind: FormFieldInfo.Kind
                switch anno.widgetFieldType {
                case .text: kind = .text
                case .button: kind = .check
                case .choice: kind = .choice
                default: continue
                }
                guard let name = anno.fieldName, !name.isEmpty else { continue }
                if widgets[name] == nil {
                    collected.append(FormFieldInfo(name: name, kind: kind, index: collected.count))
                    widgets[name] = []
                }
                widgets[name]?.append(anno)
                switch kind {
                case .text: texts[name] = anno.widgetStringValue ?? ""
                case .choice: choices[name] = anno.widgetStringValue ?? ""
                case .check: checks[name] = anno.buttonWidgetState == PDFWidgetCellState.onState
                }
            }
        }
        fields = collected
        widgetMap = widgets
        textValues = texts
        choiceValues = choices
        checkValues = checks
        statusIsError = false
        if !collected.isEmpty {
            status = L10n.t("ui.forms.count", String(collected.count))
        }
    }

    private func refreshPDF() {
        tab.pdfView.needsDisplay = true
    }

    private func applyText(_ name: String, _ value: String) {
        for anno in widgetMap[name] ?? [] { anno.widgetStringValue = value.isEmpty ? nil : value }
        refreshPDF()
    }

    private func applyChoice(_ name: String, _ value: String) {
        for anno in widgetMap[name] ?? [] { anno.widgetStringValue = value.isEmpty ? nil : value }
        refreshPDF()
    }

    private func applyCheck(_ name: String, _ value: Bool) {
        for anno in widgetMap[name] ?? [] {
            anno.buttonWidgetState = value ? PDFWidgetCellState.onState : PDFWidgetCellState.offState
        }
        refreshPDF()
    }

    // MARK: export

    private func exportFilledPdf() {
        guard !exportBusy else { return }
        guard !tab.path.isEmpty else {
            setStatus(L10n.t("ui.forms.export-disk-only"), error: true)
            return
        }
        guard !fields.isEmpty else {
            setStatus(L10n.t("ui.forms.export-none"), error: true)
            return
        }
        guard let doc = tab.document else { return }
        exportBusy = true
        setStatus(L10n.t("ui.forms.generating"))

        let panel = NSSavePanel()
        panel.allowedContentTypes = [.pdf]
        let baseName = tab.title.replacingOccurrences(
            of: "\\.pdf$", with: "", options: [.regularExpression, .caseInsensitive])
        panel.nameFieldStringValue = baseName + L10n.t("ui.forms.export-suffix") + ".pdf"

        panel.begin { response in
            defer { exportBusy = false }
            guard response == .OK, let url = panel.url else {
                setStatus(L10n.t("ui.forms.export-cancelled"))
                return
            }
            // Values already live on the in-memory document's widget
            // annotations (set while editing); dataRepresentation writes
            // them out with fresh appearance streams.
            guard let data = doc.dataRepresentation() else {
                setStatus(L10n.t("ui.forms.export-failed", "empty document data"), error: true)
                return
            }
            do {
                try data.write(to: url)
                let filled = textValues.values.filter { !$0.isEmpty }.count
                    + choiceValues.values.filter { !$0.isEmpty }.count
                    + checkValues.values.filter { $0 }.count
                setStatus(L10n.t("ui.forms.export-ok", String(filled)))
            } catch {
                setStatus(L10n.t("ui.forms.export-failed", error.localizedDescription), error: true)
            }
        }
    }

    private func setStatus(_ text: String, error: Bool = false) {
        status = text
        statusIsError = error
    }
}
