/**
 * Application fixtures for the API suites. A complete, valid application for
 * each account type — the tests vary one field at a time to prove the server
 * rejects what it should.
 */

export type ApplicationFixture = Record<string, unknown>;

export function applicationFor(
  accountType: "personal" | "business",
  name = "Rae Kim",
  businessName = "Rae & Co Studio",
): ApplicationFixture {
  const [firstName = "Rae", ...rest] = name.split(/\s+/);
  const lastName = rest.length ? rest.join(" ") : "Kim";
  const base: ApplicationFixture = {
    firstName, middleName: "", lastName,
    dob: "1990-05-12", ssn: "527-44-8213", citizenship: "United States",
    phone: "+1 (555) 010-2233",
    addressLine1: "88 Harper Street", addressLine2: "", city: "Austin", state: "TX",
    postalCode: "78701", country: "United States",
    idType: "Driver's license", idNumber: "TX-8817442", idIssuer: "Texas", idExpiry: "2030-01-31",
    occupation: "Founder", employer: businessName, incomeRange: "$100,000 – $250,000", sourceOfFunds: "Business income",
  };
  if (accountType === "personal") {
    return { ...base, occupation: "Product designer", employer: "Northwind Studio", incomeRange: "$50,000 – $100,000", sourceOfFunds: "Salary or wages" };
  }
  return {
    ...base,
    legalName: businessName, dba: "", ein: "83-1174265", businessType: "Multi-member LLC",
    formationState: "TX", formationDate: "2019-06-03", industry: "Design services", website: "raestudio.com",
    monthlyVolume: "$10,000 – $50,000",
    bizAddressLine1: "88 Harper Street", bizAddressLine2: "", bizCity: "Austin", bizState: "TX",
    bizPostalCode: "78701", bizCountry: "United States",
    ownerName: name, ownerTitle: "Managing Member", ownerDob: "1990-05-12", ownerSsn: "527-44-8213", ownerOwnership: 100,
  };
}
