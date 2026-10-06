import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { applicationFor } from '../../server/scripts/fixtures';
test.skip((process.env.ACCOUNT_LEDGER_ENABLED || process.env.DEMO_PAYMENTS_ENABLED) !== '1', 'Explicit demo-only fixture; legacy suite keeps payment sandbox off.');
const password='Demo-Browser-Test-2026!';
async function fixture(request:APIRequestContext,label:string,phone:string,type:'personal'|'business'='personal') {
 const admin=(await(await request.post('/api/auth/login',{data:{email:'admin@veyra.dev',password:'veyra-admin-2026'}})).json()).token;
 const name=`${label} Browser`,email=`${label.toLowerCase()}-${Date.now()}@veyra.test`;
 const r=await request.post('/api/auth/register',{data:{name,email,password,accountType:type,business:type==='business'?'Demo Browser Co.':'',profile:{...applicationFor(type,name,'Demo Browser Co.'),phone}}});expect(r.status()).toBe(201);const u=await r.json();
 expect((await request.post(`/api/admin/kyc/${u.user.id}/decision`,{headers:{authorization:`Bearer ${admin}`},data:{decision:'approved'}})).status()).toBe(200);
 return {name,email,phone,token:u.token};
}
async function login(page:Page,email:string){await page.goto('/#/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(/#\/app/);}
async function fits(page:Page){expect(await page.evaluate(()=>Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)-innerWidth)).toBeLessThanOrEqual(1);for(const dialog of await page.getByRole('dialog').all())expect(await dialog.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);}
async function decode(page:Page){const src=await page.getByRole('img',{name:'Scannable QR for this Veyra payment link'}).getAttribute('src');const png=PNG.sync.read(Buffer.from(src!.split(',')[1],'base64'));const qr=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);expect(qr).not.toBeNull();return qr!.data;}
async function account(request:APIRequestContext,token:string){return (await(await request.get('/api/me/state',{headers:{authorization:`Bearer ${token}`}})).json()).account;}
async function addFunds(page:Page,method='Debit card',amount='100.00'){
 await page.getByRole('button',{name:'Add funds',exact:true}).first().click();const dialog=page.getByRole('dialog',{name:'Add funds',exact:true});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:method,exact:true}).click();await dialog.getByLabel('Amount (USD)',{exact:true}).fill(amount);await dialog.getByRole('button',{name:'Add funds now',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Funds added to your account immediately');return dialog;
}
for(const type of ['personal','business'] as const)test(`${type}: original Add funds credits normal balance immediately and persists`,async({page,request})=>{
 const u=await fixture(request,`Funding${type}`,type==='personal'?'+1 555 019 8101':'+1 555 019 8102',type);await login(page,u.email);await page.goto('/#/app/transfers');await expect(page.getByRole('heading',{name:'Transfers',exact:true})).toBeVisible();await expect(page.getByText('PAYMENT PLAYGROUND',{exact:true})).toHaveCount(0);
 const before=await account(request,u.token),dialog=await addFunds(page,type==='personal'?'Debit card':'Link a bank (ACH)','125.50');
 expect((await account(request,u.token)).balance).toBe(before.balance+125.5);await expect(dialog.getByRole('button',{name:'Add funds now',exact:true})).toBeDisabled();await expect(dialog.getByText('Simulate approval',{exact:true})).toHaveCount(0);
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await fits(page);}
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(page.locator('.app-topbar,.topbar,.dash-topbar').first()).toContainText('$125.50');await page.reload();expect((await account(request,u.token)).balance).toBe(before.balance+125.5);
 await page.getByRole('button',{name:'Add funds',exact:true}).first().click();await expect(page.getByRole('dialog',{name:'Add funds',exact:true}).locator('.banking-request').first()).toContainText('$125.50');
});

test('QR email/phone and signed-out deep link work with the restored transfer form',async({page,request,browser})=>{
 const receiver=await fixture(request,'Receiver','+1 (555) 019-8103'),sender=await fixture(request,'Sender','+1 555 019 8104');
 const sources=(await(await request.get('/api/me/funding',{headers:{authorization:`Bearer ${sender.token}`}})).json()).methods;
 expect((await request.post('/api/me/deposits',{headers:{authorization:`Bearer ${sender.token}`},data:{methodId:sources[0].id,amount:'100',requestKey:crypto.randomUUID(),demo:true}})).status()).toBe(201);
 await login(page,receiver.email);await page.goto('/#/app/transfers');await page.getByRole('button',{name:/Receive Zelle.*QR/}).click();await expect(page.getByRole('img',{name:'Scannable QR for this Veyra payment link'})).toBeVisible();expect(await decode(page)).toContain(encodeURIComponent(receiver.email));
 await page.getByRole('button',{name:'Phone',exact:true}).click();await expect(page.locator('.demo-contact')).toHaveText(receiver.phone);await expect(page.getByRole('img',{name:'Scannable QR for this Veyra payment link'})).toBeVisible();const url=await decode(page);expect(url).toContain(encodeURIComponent(receiver.phone));
 await page.setViewportSize({width:320,height:844});await fits(page);
 const ctx=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});try{const payer=await ctx.newPage();await payer.goto(url);await expect(payer).toHaveURL(/#\/login/);await payer.getByLabel('Email',{exact:true}).fill(sender.email);await payer.getByLabel('Password',{exact:true}).fill(password);await payer.getByRole('button',{name:'Sign in',exact:true}).click();await expect(payer).toHaveURL(/transfers\?to=/);await expect(payer.locator('#pay-to')).toHaveValue(receiver.phone);await payer.locator('#pay-amount').fill('19.75');await payer.locator('.dash-submit').click();await expect(payer.getByRole('heading',{name:'Review payment',exact:true})).toBeVisible();await expect(payer.locator('.flow-modal')).toContainText(receiver.name);await fits(payer);await payer.locator('.flow-confirm').click();await expect(payer.locator('.flow-success')).toBeVisible();expect((await account(request,sender.token)).balance).toBe(80.25);expect((await account(request,receiver.token)).balance).toBe(19.75);}finally{await ctx.close();}
});

test('a lost deposit response can be retried without a second credit',async({page,request})=>{
 const u=await fixture(request,'Retry','+1 555 019 8105');await login(page,u.email);await page.goto('/#/app/transfers');let calls=0;
 await page.route('**/api/me/deposits',async route=>{calls++;if(calls===1){await route.fetch();await route.abort('failed');}else await route.continue();});
 await page.getByRole('button',{name:'Add funds',exact:true}).first().click();const dialog=page.getByRole('dialog',{name:'Add funds',exact:true});await dialog.getByRole('button',{name:'Wire transfer',exact:true}).click();await dialog.getByLabel('Amount (USD)',{exact:true}).fill('150');await dialog.getByRole('button',{name:'Add funds now',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();expect((await account(request,u.token)).balance).toBe(150);
 await dialog.getByRole('button',{name:'Add funds now',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Funds added');expect((await account(request,u.token)).balance).toBe(150);expect((await account(request,u.token)).transactions.filter((t:{reference:string})=>t.reference?.startsWith('VYR-'))).toHaveLength(1);
});

test('deposit success survives an account-refresh failure',async({page,request})=>{
 const u=await fixture(request,'Refresh','+1 555 019 8106');await login(page,u.email);await page.goto('/#/app/transfers');await expect(page.locator('#pay-to')).toBeVisible();
 await page.route('**/api/me/state',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"Refresh unavailable"}'}));const dialog=await addFunds(page,'Bank transfer','75');await expect(dialog.getByRole('alert')).toContainText('Funds were added');await expect(dialog.getByRole('button',{name:'Add funds now',exact:true})).toBeDisabled();expect((await account(request,u.token)).balance).toBe(75);
 await page.unroute('**/api/me/state');await dialog.getByRole('button',{name:'Refresh funding status',exact:true}).click();await expect(dialog.getByRole('alert')).toHaveCount(0);
});
