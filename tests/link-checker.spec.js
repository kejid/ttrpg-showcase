const { test, expect } = require('@playwright/test');

// Helper: skip setup screen and enter browse mode
async function skipSetup(page) {
    await page.goto('/');
    await page.waitForTimeout(500);
    const skipBtn = page.locator('button:has-text("browse"), button:has-text("посмотреть")').first();
    if (await skipBtn.isVisible()) {
        await skipBtn.click();
        await page.waitForTimeout(500);
    }
}

test.describe('Link checker', () => {
    test.setTimeout(300_000); // 5 minutes for all links

    test('all external resource links are reachable', async ({ page, request }) => {
        await skipSetup(page);

        // Get all system IDs from the registry
        const systemIds = await page.evaluate(() =>
            typeof SYSTEMS_REGISTRY !== 'undefined' ? Object.keys(SYSTEMS_REGISTRY) : []
        );
        console.log(`Found ${systemIds.length} systems to check`);

        const brokenLinks = [];
        const checked = new Map(); // url -> status

        for (const id of systemIds) {
            // Navigate via showPage (SPA routing)
            await page.evaluate(id => showPage(id), id);
            await page.waitForTimeout(400);

            // Collect links ONLY from the active system page
            const links = await page.$$eval('.system-page.active a[href^="http"]', els =>
                els.map(a => ({ url: a.href, text: a.textContent.trim().substring(0, 80) }))
            );

            for (const link of links) {
                if (checked.has(link.url)) continue; // skip already-checked URLs

                try {
                    // Try HEAD first (faster, less bandwidth)
                    const resp = await request.head(link.url, {
                        timeout: 15000,
                        ignoreHTTPSErrors: true,
                        maxRedirects: 5,
                    });
                    if (resp.ok() || resp.status() === 405 || resp.status() === 403) {
                        // 405 = Method Not Allowed (HEAD not supported), 403 = often bot protection
                        checked.set(link.url, 'ok');
                    } else {
                        // Retry with GET (some servers reject HEAD)
                        const resp2 = await request.get(link.url, {
                            timeout: 15000,
                            ignoreHTTPSErrors: true,
                            maxRedirects: 5,
                        });
                        if (resp2.ok() || resp2.status() === 403) {
                            checked.set(link.url, 'ok');
                        } else {
                            checked.set(link.url, resp2.status());
                            brokenLinks.push({ system: id, url: link.url, text: link.text, status: resp2.status() });
                        }
                    }
                } catch (e) {
                    checked.set(link.url, 'TIMEOUT/ERROR');
                    brokenLinks.push({ system: id, url: link.url, text: link.text, status: 'TIMEOUT/ERROR' });
                }
            }
            console.log(`  ✓ ${id}: ${links.length} links`);
        }

        console.log(`\nChecked ${checked.size} unique URLs across ${systemIds.length} systems`);

        if (brokenLinks.length > 0) {
            console.log('\n❌ BROKEN LINKS:');
            console.table(brokenLinks);
        } else {
            console.log('\n✅ All links are reachable!');
        }

        expect(brokenLinks, `Found ${brokenLinks.length} broken link(s)`).toEqual([]);
    });

    test('all hero images load successfully', async ({ page }) => {
        await skipSetup(page);

        const systemIds = await page.evaluate(() =>
            typeof SYSTEMS_REGISTRY !== 'undefined' ? Object.keys(SYSTEMS_REGISTRY) : []
        );

        const brokenImages = [];

        for (const id of systemIds) {
            await page.evaluate(id => showPage(id), id);
            await page.waitForTimeout(400);

            // Check hero banner image on the ACTIVE page
            const heroUrl = await page.evaluate(() => {
                const active = document.querySelector('.system-page.active');
                if (!active) return null;
                const hero = active.querySelector('.hero-banner');
                if (!hero) return null;
                const bg = getComputedStyle(hero).backgroundImage;
                const match = bg.match(/url\("?(.+?)"?\)/);
                return match ? match[1] : null;
            });

            if (heroUrl) {
                try {
                    const resp = await page.request.head(heroUrl, { timeout: 10000, ignoreHTTPSErrors: true });
                    if (!resp.ok() && resp.status() !== 403) {
                        brokenImages.push({ system: id, url: heroUrl, status: resp.status() });
                    }
                } catch {
                    brokenImages.push({ system: id, url: heroUrl, status: 'TIMEOUT/ERROR' });
                }
            }
            console.log(`  ✓ ${id}: hero image ${heroUrl ? 'checked' : 'none'}`);
        }

        if (brokenImages.length > 0) {
            console.log('\n❌ BROKEN HERO IMAGES:');
            console.table(brokenImages);
        } else {
            console.log('\n✅ All hero images load!');
        }

        expect(brokenImages, `Found ${brokenImages.length} broken hero image(s)`).toEqual([]);
    });
});
