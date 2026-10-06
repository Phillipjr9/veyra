import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { applicationFor } from "../../server/scripts/fixtures";

const password="Banking-Browser-Test-2026!";
const adminCredentials={email:"admin@veyra.dev",password:"veyra-admin-2026"};
async function signIn(page:Page,email:string,pass=password) {
 await page.goto('/#/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(pass);
 const wait=page.waitForResponse(r=>r.url().endsWith('/api/auth/login')&&r.request().method()==='POST');await page.getByRole('button',{name:'Sign in',exact:true}).click();const r=await wait;expect(r.status()).toBe(200);await expect(page).toHaveURL(/#\/app/);return r.json();
}
async function fixture(request:APIRequestContext,type:'personal'|'business'='personal') {
 const admin=await (await request.post('/api/auth/login',{data:adminCredentials})).json();
 const name=`Banking ${String(Date.now()).replace(/\d/g,d=>String.fromCharCode(65+Number(d)))}`;const email=`banking-${type}-${Date.now()}@veyra.test`;
 const r=await request.post('/api/auth/register',{data:{name,email,password,accountType:type,business:type==='business'?'Browser Ltd':'',profile:applicationFor(type,name,'Browser Ltd')}});expect(r.status()).toBe(201);const u=await r.json();
 expect((await request.post(`/api/admin/kyc/${u.user.id}/decision`,{headers:{authorization:`Bearer ${admin.token}`},data:{decision:'approved'}})).status()).toBe(200);
 return {name,email,token:u.token,id:u.user.id,admin:admin.token};
}
async function fits(page:Page) {
 expect(await page.evaluate(()=>Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)-innerWidth)).toBeLessThanOrEqual(1);
 for(const dialog of await page.getByRole('dialog').all()){const r=await dialog.boundingBox();if(r){expect(r.x).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(page.viewportSize()!.width);}}
}

test('pricing agrees with personal/business signup and removes unsupported annual discounts',async({page})=>{
 await page.goto('/#/pricing');await expect(page.locator('.plan').filter({has:page.getByRole('heading',{name:'Everyday',exact:true})})).toContainText('$0');await expect(page.locator('.plan').filter({has:page.getByRole('heading',{name:'Plus',exact:true})})).toContainText('$9');
 await page.getByRole('button',{name:'Choose Plus',exact:true}).click();await expect(page).toHaveURL(/type=personal&plan=Pro/);await expect(page.locator('.plan-toggle .on')).toContainText('$9/mo');
 await page.goto('/#/pricing');await page.getByRole('button',{name:'Business',exact:true}).click();await expect(page.locator('.plan.featured')).toContainText('$99');
 await page.getByRole('button',{name:'Choose Pro',exact:true}).click();await expect(page.locator('.plan-toggle .on')).toContainText('$99/mo');
 await page.goto('/#/pricing');await expect(page.getByRole('button',{name:/Annual/})).toHaveCount(0);await expect(page.getByText(/Subscription billing and plan-specific feature limits are not currently enforced/)).toBeVisible();
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await fits(page);}
});

test('admin edits account details and per-member funding; member request waits for staff confirmation',async({page,browser,request})=>{
 const u=await fixture(request);await signIn(page,adminCredentials.email,adminCredentials.password);
 await page.setViewportSize({width:390,height:844});await page.getByRole('combobox',{name:'Open admin module'}).selectOption('customers');
 const row=page.locator('tr').filter({hasText:u.email});await row.getByRole('button',{name:'Account details',exact:true}).click();
 const editor=page.getByRole('dialog',{name:`Account details: ${u.name}`});
 await editor.getByLabel('Account number',{exact:true}).fill('23456789012345');await editor.getByLabel('Routing number',{exact:true}).fill('021000021');await editor.getByLabel('Bank name',{exact:true}).fill('Browser Test Bank');
 await editor.getByLabel('Bank account type',{exact:true}).selectOption('Savings');await editor.getByLabel('Reason for change').fill('Synthetic account update test');await fits(page);
 await editor.getByRole('button',{name:'Save account details'}).click();await expect(editor).toBeHidden();
 await row.getByRole('button',{name:'Funding',exact:true}).click();const manager=page.getByRole('dialog',{name:`Funding: ${u.name}`});
 await manager.getByRole('button',{name:'Add funding method'}).click();await manager.getByLabel('Source / method label').fill('Browser verified wire');await manager.getByLabel('Instructions',{exact:true}).fill('Synthetic-only funding instructions; do not transfer real money.');
 await manager.getByLabel('Recipient / account holder').fill(u.name);await manager.getByLabel('Bank name',{exact:true}).fill('Browser Test Bank');await manager.getByLabel('Routing number',{exact:true}).fill('021000021');await manager.getByLabel('Receiving account number (not a card number)',{exact:true}).fill('23456789012345');
 await manager.getByRole('button',{name:'Save funding methods'}).click();await expect(manager.getByRole('status')).toContainText('Funding methods saved');await fits(page);
 await manager.getByRole('button',{name:'Close',exact:true}).click();
 const ctx=await browser.newContext({viewport:{width:320,height:844},reducedMotion:'reduce'});const member=await ctx.newPage();
 try {
  await signIn(member,u.email);await member.goto('/#/app/accounts');await expect(member.locator('.checking-account-card')).toContainText('Personal savings');
  await member.goto('/#/app');await member.getByRole('button',{name:'Add funds',exact:true}).filter({visible:true}).first().click();
  const funds=member.getByRole('dialog',{name:'Add funds',exact:true});await expect(funds).toContainText('Browser verified wire');await expect(funds).toContainText('23456789012345');await funds.getByLabel('Amount (USD)',{exact:true}).fill('75');await funds.getByRole('button',{name:'Submit funding request'}).click();await expect(funds.getByRole('status')).toContainText('pending');await fits(member);
  let state=await (await request.get('/api/me/state',{headers:{authorization:`Bearer ${u.token}`}})).json();expect(state.account.balance).toBe(0);
  await row.getByRole('button',{name:'Funding',exact:true}).click();await manager.getByRole('button',{name:'Confirm received funds',exact:true}).click();await manager.getByLabel('Evidence / reason').fill('Synthetic independent bank receipt check');await manager.getByRole('button',{name:'Commit review'}).click();await expect(manager.getByText('$75.00 · confirmed',{exact:true})).toBeVisible();
  state=await (await request.get('/api/me/state',{headers:{authorization:`Bearer ${u.token}`}})).json();expect(state.account.balance).toBe(75);await expect(manager.getByRole('button',{name:'Confirm received funds'})).toHaveCount(0);
  await funds.getByRole('button',{name:'Refresh funding status'}).click();await expect(funds.getByText('$75.00 · confirmed',{exact:true})).toBeVisible();await funds.getByRole('button',{name:'Close',exact:true}).click();await member.goto('/#/app/accounts');await expect(member.locator('.checking-account-card')).toContainText('$75.00');
 } finally {await ctx.close();}
});

test('personal category is optional, business category required and transaction receipt is a real PDF',async({page,request})=>{
 const u=await fixture(request);await request.post(`/api/admin/members/${u.id}/adjust`,{headers:{authorization:`Bearer ${u.admin}`},data:{direction:'credit',amount:100,memo:'Receipt fixture'}});
 await signIn(page,u.email);await page.goto('/#/app/transfers');await expect(page.locator('#pay-cat')).not.toHaveAttribute('required','');await expect(page.locator('#pay-cat')).toHaveValue('');
 await page.goto('/#/app/transactions');await page.locator('.txn-trow').first().click();const drawer=page.getByRole('dialog',{name:'Transaction details'});
 const wait=page.waitForEvent('download');await drawer.getByRole('button',{name:'Receipt',exact:true}).click();const download=await wait;expect(download.suggestedFilename()).toMatch(/^veyra-receipt-.+\.pdf$/);const bytes=await readFile((await download.path())!);expect(bytes.subarray(0,5).toString()).toBe('%PDF-');expect(bytes.length).toBeGreaterThan(2000);
 await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});await page.reload();await signIn(page,'demo.business@veyra.dev','veyra-demo-2026');await page.goto('/#/app/transfers');await expect(page.locator('#pay-cat')).toHaveAttribute('required','');
});

test('catalog is separate from holdings; animated crypto request remains pending and can be cancelled',async({page,request})=>{
 const u=await fixture(request);await request.post(`/api/admin/members/${u.id}/adjust`,{headers:{authorization:`Bearer ${u.admin}`},data:{direction:'credit',amount:100,memo:'Crypto fixture'}});
 await signIn(page,u.email);await page.goto('/#/app/accounts');await expect(page.locator('.holding-card')).toHaveCount(0);await page.getByRole('link',{name:'Browse assets'}).click();await expect(page.locator('.holding-card')).toHaveCount(24);
 const usdc=page.locator('.holding-card').filter({has:page.locator('.holding-code',{hasText:/^USDC$/})});await usdc.getByRole('button',{name:'Buy',exact:true}).click();const buy=page.getByRole('dialog',{name:'Buy USDC',exact:true});await buy.getByLabel('Amount to spend').fill('25');await buy.getByRole('button',{name:'Buy',exact:true}).click();await expect(buy).toBeHidden();
 await page.getByRole('link',{name:'View your holdings'}).click();await expect(page.locator('.holding-card')).toHaveCount(1);await usdc.getByRole('button',{name:'Send',exact:true}).click();const send=page.getByRole('dialog',{name:'Send USDC',exact:true});
 await send.getByLabel('Destination wallet address').fill('0x1111111111111111111111111111111111111111');await send.getByLabel('Quantity (USDC)').fill('10.123456');
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await fits(page);}
 await send.getByRole('button',{name:'Review withdrawal'}).click();await page.setViewportSize({width:320,height:844});await fits(page);
 // Hold the real server response briefly to check the processing animation.
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 await page.route('**/api/me/crypto-withdrawals',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();await gate;await route.fulfill({response});});
 await send.getByRole('button',{name:'Confirm pending withdrawal'}).click();await expect(send.getByText('Submitting withdrawal request…',{exact:true})).toBeVisible();await expect(send.locator('.flow-track')).toBeVisible();release();
 await expect(send.getByText('Pending · not broadcast',{exact:true})).toBeVisible();await expect(send.getByText(/No transaction hash or blockchain confirmation exists/)).toBeVisible();await send.getByRole('button',{name:'Close',exact:true}).click();
 await expect(usdc).toContainText('10.123456 reserved (pending)');await page.reload();await expect(page.locator('.crypto-request-history')).toContainText('pending');await page.getByRole('button',{name:'Cancel and release units'}).click();await expect(usdc).toContainText('Available: 25 USDC');await expect(page.locator('.crypto-request-history')).toContainText('cancelled');
});
