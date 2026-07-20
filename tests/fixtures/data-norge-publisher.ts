export const dataNorgePublisherTurtle = `PREFIX br: <https://raw.githubusercontent.com/Informasjonsforvaltning/organization-catalog/main/src/main/resources/ontology/organization-catalog.owl#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX org: <http://www.w3.org/ns/org#>
PREFIX orgstatus: <https://raw.githubusercontent.com/Informasjonsforvaltning/organization-catalog/main/src/main/resources/ontology/org-status.ttl#>
PREFIX orgtype: <https://raw.githubusercontent.com/Informasjonsforvaltning/organization-catalog/main/src/main/resources/ontology/org-type.ttl#>
PREFIX rov: <http://www.w3.org/ns/regorg#>

<https://organization-catalog.fellesdatakatalog.digdir.no/organizations/991825827>
  a foaf:Agent, rov:RegisteredOrganization ;
  dct:identifier "991825827" ;
  org:subOrganizationOf <https://organization-catalog.fellesdatakatalog.digdir.no/organizations/932384469> ;
  rov:legalName "DIGITALISERINGSDIREKTORATET" ;
  rov:orgStatus orgstatus:NormalAktivitet ;
  rov:orgType orgtype:ORGL ;
  foaf:homepage <https://www.digdir.no/> ;
  foaf:name "Digitaliseringsdirektoratet"@nb ;
  br:orgPath "/STAT/932384469/991825827" .`;
