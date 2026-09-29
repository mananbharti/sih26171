import {test,expect} from '@playwright/test';
test('application approval, receipt masking and successful simulated completion',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.screenshot({path:'../screenshots/orvia-desktop.png',fullPage:true});
 await page.getByRole('button',{name:/TRY A COMPLETE WORKFLOW/}).click();
 await expect(page.getByRole('button',{name:'Approve demo application'})).toBeVisible();
 await expect(page.locator('.sample-form input').first()).toHaveValue('');
 await page.screenshot({path:'../screenshots/orvia-approval.png',fullPage:true});
 await page.getByRole('button',{name:'Approve demo application'}).click();
 await expect(page.getByText('Great things start here.')).toBeVisible();
 await page.getByRole('button',{name:'View privacy receipt'}).click();
 await expect(page.locator('.payload')).not.toContainText('aarav.mehta@example.com');
 await expect(page.locator('.payload')).not.toContainText('fellowships@example.com');
 await expect(page.locator('.payload')).toContainText('[EMAIL]');
 await page.screenshot({path:'../screenshots/orvia-privacy-receipt.png',fullPage:true});
 expect(errors).toEqual([]);
});
test('summary and extraction finish without approval',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Summarize page',exact:true}).click();
 await expect(page.getByText('Your page, at a glance')).toBeVisible();
 await expect(page.getByText('₹25,000 / month · Bengaluru, hybrid',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'New task',exact:true}).click();
 await page.getByRole('button',{name:'Extract data',exact:true}).click();
 await expect(page.getByRole('button',{name:'Export JSON'})).toBeVisible();
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export JSON'}).click();const file=await downloadPromise;expect(file.suggestedFilename()).toBe('orvia-extracted-data.json');
});
test('decline prevents mutation and cancellation prevents a late approval',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Fill a form',exact:true}).click();
 await expect(page.getByRole('button',{name:'Approve & fill fields'})).toBeVisible();
 await page.getByRole('button',{name:'Decline and stop'}).click();
 await expect(page.locator('.sample-form input').first()).toHaveValue('');
 await page.getByRole('button',{name:'Start a new task',exact:true}).click();
 await page.getByRole('button',{name:'Fill a form',exact:true}).click();await page.getByRole('button',{name:'Stop task'}).click();
 await page.waitForTimeout(1000);await expect(page.getByRole('button',{name:'Approve & fill fields'})).toHaveCount(0);
});
test('resilience controls exercise replan and DOM fallback; mobile remains usable',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'../screenshots/orvia-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Local profile and settings'}).click();
 await page.getByRole('checkbox',{name:/Page layout changes/}).check();await page.getByRole('checkbox',{name:/Visual perception unavailable/}).check();
 await page.getByRole('button',{name:'Close details'}).click();await page.getByRole('button',{name:'Fill a form',exact:true}).click();
 await expect(page.getByRole('button',{name:'Approve & fill fields'})).toBeVisible();await page.getByRole('button',{name:'Approve & fill fields'}).click();
 await expect(page.locator('.sample-form input').first()).toHaveValue('Aarav Mehta');
 await page.getByRole('button',{name:/View activity/}).click();await expect(page.locator('.timeline')).toContainText('Fallback');await expect(page.locator('.timeline')).toContainText('Replan');
});
