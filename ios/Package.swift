// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "DaguanCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "DaguanCore", targets: ["DaguanCore"])],
    targets: [
        .target(name: "DaguanCore", path: "Sources", exclude: ["App", "WebBridge"], sources: ["Storage", "AI"]),
        .testTarget(name: "DaguanCoreTests", dependencies: ["DaguanCore"], path: "Tests")
    ]
)
