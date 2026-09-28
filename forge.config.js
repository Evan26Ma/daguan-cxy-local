import { prepareDesktopPackage } from "./scripts/prepare-desktop-package.mjs";

export default {
  packagerConfig: {
    asar: false,
    ...(process.env.DAGUAN_ELECTRON_ZIP_DIR ? { electronZipDir: process.env.DAGUAN_ELECTRON_ZIP_DIR } : {}),
    executableName: "DaguanMath",
    appBundleId: "com.daguan.math-local",
    ignore: [
      /[/\\]android(?:[/\\]|$)/i,
      /[/\\]docs(?:[/\\]|$)/i,
      /[/\\]test(?:[/\\]|$)/i,
      /[/\\]tools(?:[/\\]|$)/i,
      /[/\\]scripts(?:[/\\]|$)/i,
      /[/\\]packaging(?:[/\\]|$)/i,
      /[/\\]sync-extension(?:[/\\]|$)/i,
      /[/\\]deploy(?:[/\\]|$)/i,
      /[/\\](?:\.build|dist|out|\.runtime)(?:[/\\]|$)/i,
      /[/\\]web[/\\]ui-preview(?:[/\\]|$)/i,
      /[/\\]web[/\\]index-.*-backup\.html$/i,
      /[/\\]交接文档-本地题库与UI设计\.md$/,
      /[/\\](?:安装大观园数学题库|启动本地题库(?:-Docker)?)\.cmd$/,
    ],
    afterCopy: [(buildPath, _electronVersion, _platform, _arch, callback) => {
      prepareDesktopPackage(buildPath).then(() => callback(), callback);
    }],
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: process.env.DAGUAN_SQUIRREL_NAME || "DaguanMathDesktop",
        authors: "Evan26Ma",
        description: "Windows 本地数学题库学习应用",
        setupExe: process.env.DAGUAN_SQUIRREL_SETUP_EXE || "DaguanMathDesktop-Setup.exe",
      },
    },
  ],
};
