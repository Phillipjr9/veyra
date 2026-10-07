import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { applicationFor } from '../../server/scripts/fixtures';
const admin={email:'admin@veyra.dev',password:'veyra-admin-2026'};
const password='Customer-Browser-Test-2026!';
async function signIn(page:Page,email=admin.email,pass=admin.password){await page.goto('/#/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(pass);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(/#\/app/);}
async function fixture(request:APIRequestContext,label:string){
 const adminToken=(await(await request.post('/api/auth/login',{data:admin})).json()).token;
 const suffix=String(Date.now()).replace(/\d/g,d=>String.fromCharCode(65+Number(d)));const name=`${label} ${suffix}`,email=`customer-${label.toLowerCase()}-${Date.now()}@veyra.test`;
 const r=await request.post('/api/auth/register',{data:{name,email,password,accountType:'personal',profile:applicationFor('personal',name)}});expect(r.status()).toBe(201);const u=await r.json();
 expect((await request.post(`/api/admin/kyc/${u.user.id}/decision`,{headers:{authorization:`Bearer ${adminToken}`},data:{decision:'approved'}})).status()).toBe(200);
 return {id:u.user.id,token:u.token,name,email,adminToken};
}
async function fits(page:Page){expect(await page.evaluate(()=>Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)-innerWidth)).toBeLessThanOrEqual(1);for(const dialog of await page.getByRole('dialog').all())expect(await dialog.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);}

test('each customer has a reloadable admin page with bank, funding, balance and status controls',async({page,request,browser})=>{
 const u=await fixture(request,'Profile');await signIn(page);await page.goto('/#/app/superadmin?module=customers');
 await page.getByRole('link',{name:u.name,exact:true}).click();await expect(page).toHaveURL(new RegExp(`/customers/${u.id}$`));await expect(page.getByRole('heading',{name:u.name,exact:true})).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{name:'Bank account details',exact:true})).toBeVisible();await expect(page.getByText('Email delivery not configured',{exact:true})).toBeVisible();
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await fits(page);}
 await page.getByRole('button',{name:'Edit account details',exact:true}).click();const bank=page.getByRole('dialog',{name:`Account details: ${u.name}`});
 await bank.getByLabel('Bank name',{exact:true}).fill('Customer Page Bank');await bank.getByLabel('Reason for change').fill('Browser fixture bank correction');await bank.getByRole('button',{name:'Save account details',exact:true}).click();await expect(bank).toBeHidden();await expect(page.getByText('Customer Page Bank',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Funding methods & requests',exact:true}).click();await expect(page.getByRole('dialog',{name:`Funding: ${u.name}`})).toBeVisible();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Adjust balance',exact:true}).click();const adjustment=page.getByRole('dialog',{name:'Adjust member balance'});
 await adjustment.getByLabel('Adjustment amount (USD)').fill('75');await adjustment.getByLabel('Reason for account action').fill('Synthetic browser adjustment');await adjustment.getByRole('button',{name:'Review account action'}).click();await adjustment.getByRole('button',{name:'Confirm account action'}).click();await expect(adjustment).toBeHidden();await expect(page.locator('.member-balance')).toContainText('$75.00');
 await page.getByRole('button',{name:'Restrict account',exact:true}).click();const status=page.getByRole('dialog',{name:'Change member status'});await status.getByLabel('Reason for account action').fill('Synthetic browser review hold');await status.getByRole('button',{name:'Review account action'}).click();await status.getByRole('button',{name:'Confirm account action'}).click();await expect(status).toBeHidden();await expect(page.getByRole('button',{name:'Restore account',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Restore account',exact:true}).click();await status.getByRole('button',{name:'Review account action'}).click();await status.getByRole('button',{name:'Confirm account action'}).click();await expect(page.getByRole('button',{name:'Restrict account',exact:true})).toBeVisible();
 const ctx=await browser.newContext();try{const member=await ctx.newPage();await signIn(member,u.email,password);await member.goto(`/#/app/superadmin/customers/${u.id}`);await expect(member).toHaveURL(/#\/app$/);await expect(member.getByRole('button',{name:'Edit account details',exact:true})).toHaveCount(0);}finally{await ctx.close();}
 await page.goto('/#/app/superadmin/customers/no-such-customer');await expect(page.getByRole('heading',{name:'Customer unavailable'})).toBeVisible();await expect(page.getByRole('button',{name:'Edit account details',exact:true})).toHaveCount(0);
});

test('bulk bank changes review selected/all owners, preserve unique numbers, and persist',async({page,request})=>{
 const a=await fixture(request,'Batchalpha'),b=await fixture(request,'Batchbeta');await signIn(page);await page.goto('/#/app/superadmin?module=customers');
 const original=await(await request.get(`/api/admin/members/${a.id}/account-details`,{headers:{authorization:`Bearer ${a.adminToken}`}})).json();
 await page.getByRole('button',{name:'Bulk account details',exact:true}).click();const bulk=page.getByRole('dialog',{name:'Bulk account details',exact:true});
 await bulk.getByLabel(`Select ${a.email}`,{exact:true}).check();await bulk.getByLabel(`Select ${b.email}`,{exact:true}).check();
 await bulk.getByLabel('Apply bank name',{exact:true}).check();await bulk.getByLabel('New bank name',{exact:true}).fill('Batch Preview Bank');
 await bulk.getByLabel('Apply routing number',{exact:true}).check();await bulk.getByLabel('New routing number',{exact:true}).fill('021000021');
 await bulk.getByLabel('Apply bank account type',{exact:true}).check();await bulk.getByLabel('New bank account type',{exact:true}).selectOption('Savings');
 await bulk.getByLabel('Reason for bulk change').fill('Synthetic shared metadata update');
 await page.setViewportSize({width:320,height:844});await fits(page);await bulk.getByRole('button',{name:'Review changes',exact:true}).click();await expect(bulk.getByRole('heading',{name:'Review 2 accounts',exact:true})).toBeVisible();
 const unchanged=await(await request.get(`/api/admin/members/${a.id}/account-details`,{headers:{authorization:`Bearer ${a.adminToken}`}})).json();expect(unchanged.account.bankName).toBe(original.account.bankName);
 await expect(bulk).toContainText('Before:');await expect(bulk).toContainText('After: Batch Preview Bank');
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await fits(page);}
 await expect(bulk.getByRole('button',{name:'Apply to 2 accounts',exact:true})).toBeDisabled();await bulk.getByLabel('Type UPDATE 2 to confirm').fill('UPDATE 2');await bulk.getByRole('button',{name:'Apply to 2 accounts',exact:true}).click();await expect(bulk.getByRole('status')).toContainText('2 of 2');await bulk.getByRole('button',{name:'Done',exact:true}).click();
 const changed=await(await request.get(`/api/admin/members/${a.id}/account-details`,{headers:{authorization:`Bearer ${a.adminToken}`}})).json();expect(changed.account.accountNumber).toBe(original.account.accountNumber);expect(changed.account.bankName).toBe('Batch Preview Bank');expect(changed.account.bankAccountType).toBe('Savings');
 // All owners is deliberately broader than the current directory filter.
 await page.getByPlaceholder('Filter by name, email or business…').fill(a.email);await page.getByRole('button',{name:'Bulk account details',exact:true}).click();
 await bulk.getByLabel('Target accounts',{exact:true}).selectOption('all');await bulk.getByLabel('Apply bank name',{exact:true}).check();await bulk.getByLabel('New bank name',{exact:true}).fill('Platform Shared Bank');await bulk.getByLabel('Reason for bulk change').fill('Synthetic all-owner bank update');await bulk.getByRole('button',{name:'Review changes',exact:true}).click();
 const text=await bulk.getByRole('heading',{name:/^Review \d+ accounts$/}).textContent();const count=Number(text!.match(/\d+/)![0]);expect(count).toBeGreaterThanOrEqual(4);await bulk.getByLabel(`Type UPDATE ${count} to confirm`).fill(`UPDATE ${count}`);await bulk.getByRole('button',{name:`Apply to ${count} accounts`,exact:true}).click();await expect(bulk.getByRole('status')).toContainText('Account details updated');await bulk.getByRole('button',{name:'Done',exact:true}).click();
 await page.goto(`/#/app/superadmin/customers/${b.id}`);await expect(page.getByText('Platform Shared Bank',{exact:true})).toBeVisible();
});

test('Zelle email studio previews distinguish ledger activity, pending review and confirmed credits',async({page})=>{
 await page.goto('/#/email-templates');await page.getByRole('button',{name:/^Transfers \d+$/}).click();
 await page.getByRole('button',{name:/Zelle outgoing · ledger recorded/}).click();
 const frame=page.frameLocator('iframe');await expect(frame.getByRole('heading',{name:'Outgoing Zelle transfer recorded'})).toBeVisible();await expect(frame.getByText(/not confirmation that a payment was sent through Zelle/)).toBeVisible();
 await page.getByRole('button',{name:/Zelle incoming · pending review/}).click();await expect(frame.getByRole('heading',{name:'Incoming Zelle funding request pending'})).toBeVisible();await expect(frame.getByText(/No funds have been confirmed or credited/)).toBeVisible();
 await page.getByRole('button',{name:/Zelle incoming · funds credited/}).click();await expect(frame.getByRole('heading',{name:'Incoming Zelle funds credited'})).toBeVisible();await expect(frame.getByText(/staff confirmed receipt/)).toBeVisible();
 await page.getByRole('button',{name:/Zelle incoming · request declined/}).click();await expect(frame.getByRole('heading',{name:'Incoming Zelle funding request declined'})).toBeVisible();
 await page.setViewportSize({width:390,height:844});await fits(page);
});

test('admin module navigation stays in view on desktop and remains reachable on mobile',async({page})=>{
 await signIn(page);await page.goto('/#/app/superadmin');
 const nav=page.locator('.admin-tabs-nav');
 for(const width of [1440,1024]){
  await page.setViewportSize({width,height:900});await expect(nav).toBeVisible();
  const layout=await nav.evaluate(el=>{const r=el.getBoundingClientRect(),buttons=[...el.querySelectorAll('button')].map(button=>button.getBoundingClientRect());return{client:el.clientWidth,scroll:el.scrollWidth,rows:[...new Set(buttons.map(box=>Math.round(box.top)))],outside:buttons.some(box=>box.left<r.left-1||box.right>r.right+1)}});
  expect(layout.scroll).toBeLessThanOrEqual(layout.client+1);expect(layout.outside).toBe(false);expect(layout.rows.length).toBeGreaterThan(1);
 }
 await page.setViewportSize({width:390,height:844});await expect(nav).toBeHidden();
 const picker=page.getByLabel('Open admin module');await expect(picker).toBeVisible();await picker.selectOption('profile');
 await expect(page.getByText('All permissions — highest access level')).toBeVisible();
});
