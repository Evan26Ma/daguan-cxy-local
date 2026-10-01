from playwright.sync_api import sync_playwright
import os
from pathlib import Path

# 确保截图目录存在
screenshot_dir = Path("F:/AI/大观园本地/.build/ui-redesign/stage-1")
screenshot_dir.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    
    # 桌面分辨率 1440×900
    desktop = browser.new_context(viewport={'width': 1440, 'height': 900})
    desktop_page = desktop.new_page()
    
    print("📸 生成桌面分辨率截图 (1440×900)...")
    
    # 1. 首页
    desktop_page.goto('file:///F:/AI/大观园本地/web/ui-preview/pages/home.html')
    desktop_page.wait_for_timeout(500)
    desktop_page.screenshot(path=str(screenshot_dir / '1440x900-home.png'), full_page=False)
    print("  ✓ 首页")
    
    # 2. 题库
    desktop_page.goto('file:///F:/AI/大观园本地/web/ui-preview/pages/library.html')
    desktop_page.wait_for_timeout(500)
    desktop_page.screenshot(path=str(screenshot_dir / '1440x900-library.png'), full_page=False)
    print("  ✓ 题库")
    
    # 3. 做题（收起）
    desktop_page.goto('file:///F:/AI/大观园本地/web/ui-preview/pages/question.html')
    desktop_page.wait_for_timeout(500)
    desktop_page.screenshot(path=str(screenshot_dir / '1440x900-question-collapsed.png'), full_page=False)
    print("  ✓ 做题（收起）")
    
    # 4. 做题（展开解析）
    desktop_page.evaluate("document.getElementById('toggleBtn').scrollIntoView()")
    desktop_page.wait_for_timeout(200)
    desktop_page.evaluate("toggleExplanation()")
    desktop_page.wait_for_timeout(300)
    desktop_page.screenshot(path=str(screenshot_dir / '1440x900-question-expanded.png'), full_page=True)
    print("  ✓ 做题（展开）")
    
    # 5. AI 展开
    desktop_page.goto('file:///F:/AI/大观园本地/web/ui-preview/pages/question-with-ai.html')
    desktop_page.wait_for_timeout(500)
    desktop_page.screenshot(path=str(screenshot_dir / '1440x900-ai-panel.png'), full_page=False)
    print("  ✓ AI 展开")
    
    desktop.close()
    
    # 手机分辨率 390×844
    mobile = browser.new_context(viewport={'width': 390, 'height': 844})
    mobile_page = mobile.new_page()
    
    print("\n📱 生成手机分辨率截图 (390×844)...")
    
    # 1. 首页
    mobile_page.goto('file:///F:/AI/大观园本地/web/ui-preview/pages/home.html')
    mobile_page.wait_for_timeout(500)
    mobile_page.screenshot(path=str(screenshot_dir / '390x844-home.png'), full_page=True)
    print("  ✓ 首页")
    
    # 2. 题库
    mobile_page.goto('file:///F:/AI/大观园本地/web/ui-preview/pages/library.html')
    mobile_page.wait_for_timeout(500)
    mobile_page.screenshot(path=str(screenshot_dir / '390x844-library.png'), full_page=True)
    print("  ✓ 题库")
    
    # 3. 做题
    mobile_page.goto('file:///F:/AI/大观园本地/web/ui-preview/pages/question.html')
    mobile_page.wait_for_timeout(500)
    mobile_page.screenshot(path=str(screenshot_dir / '390x844-question.png'), full_page=True)
    print("  ✓ 做题")
    
    # 4. AI 展开（手机全屏）
    mobile_page.goto('file:///F:/AI/大观园本地/web/ui-preview/pages/question-with-ai.html')
    mobile_page.wait_for_timeout(500)
    mobile_page.screenshot(path=str(screenshot_dir / '390x844-ai.png'), full_page=True)
    print("  ✓ AI")
    
    mobile.close()
    
    # 360×800 特殊尺寸（长公式/图片题）
    small_mobile = browser.new_context(viewport={'width': 360, 'height': 800})
    small_page = small_mobile.new_page()
    
    print("\n📱 生成小屏手机截图 (360×800)...")
    
    # 长公式题（题目1）
    small_page.goto('file:///F:/AI/大观园本地/web/ui-preview/pages/question.html')
    small_page.wait_for_timeout(500)
    small_page.evaluate("toggleExplanation()")
    small_page.wait_for_timeout(300)
    small_page.screenshot(path=str(screenshot_dir / '360x800-long-formula.png'), full_page=True)
    print("  ✓ 长公式题")
    
    # 图片题（题目3）
    small_page.evaluate("showQuestion(3)")
    small_page.wait_for_timeout(300)
    small_page.screenshot(path=str(screenshot_dir / '360x800-image-question.png'), full_page=True)
    print("  ✓ 图片题")
    
    small_mobile.close()
    browser.close()
    
    print("\n✅ 所有截图生成完成！")
    print(f"📁 保存位置：{screenshot_dir}")
