import SwiftUI

@main
struct DaguanPadApp: App {
    var body: some Scene {
        WindowGroup { DaguanWebView().ignoresSafeArea(.container, edges: [.bottom]) }
    }
}

struct DaguanWebView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> DaguanViewController { DaguanViewController() }
    func updateUIViewController(_ controller: DaguanViewController, context: Context) {}
}
