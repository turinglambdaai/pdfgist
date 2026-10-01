import SwiftUI
import AppKit

// Warm paper/terracotta palette lifted from the v1 web UI (src/style.css).
// Colors are dynamic NSColors so every AppKit surface (PDFThumbnailView
// background, context menus) resolves the same values as the SwiftUI chrome.
enum Theme {
    static let bg = Color.dynamic(light: 0xF5F2ED, dark: 0x171412)
    static let panel = Color.dynamic(light: 0xFFFFFF, dark: 0x231F1D)
    static let panelAlt = Color.dynamic(light: 0xFAF8F5, dark: 0x2A2624)
    static let border = Color.dynamic(light: 0xE7E5E4, dark: 0x3D3835)
    static let borderStrong = Color.dynamic(light: 0xD6D3D1, dark: 0x4A4440)
    static let text = Color.dynamic(light: 0x1C1917, dark: 0xE7E5E4)
    static let textDim = Color.dynamic(light: 0x57534E, dark: 0xA8A29E)
    static let textFaint = Color.dynamic(light: 0xA8A29E, dark: 0x78716C)
    static let accent = Color.dynamic(light: 0xD97757, dark: 0xE8926A)
    static let accentHover = Color.dynamic(light: 0xC4623E, dark: 0xF0A07C)
    static let accentSoft = Color.dynamic(light: 0xFFF7ED, dark: 0x2D2218)
    static let accentBorder = Color.dynamic(light: 0xF1D5C4, dark: 0x4A3428)
    static let danger = Color.dynamic(light: 0xB3261E, dark: 0xF2B8B5)

    // Annotation chips (v1 .note-dot colors).
    static func annotationColor(_ name: String) -> NSColor {
        switch name {
        case "green": return NSColor(hex: 0x4CC383, alpha: 0.85)
        case "blue": return NSColor(hex: 0x569CFF, alpha: 0.85)
        default: return NSColor(hex: 0xFFD500, alpha: 0.9)
        }
    }

    static func annotationSwiftUIColor(_ name: String) -> Color {
        Color(nsColor: annotationColor(name))
    }
}

extension Color {
    static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return NSColor(hex: isDark ? dark : light)
        })
    }
}

extension NSColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha)
    }
}

// AppKit helpers tinted from the same palette.
extension NSColor {
    static var gistPanel: NSColor { NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            ? NSColor(hex: 0x231F1D) : NSColor(hex: 0xFFFFFF)
    } }
}
