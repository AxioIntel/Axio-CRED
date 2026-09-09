@description('Short lowercase name used in Azure resource names.')
@minLength(3)
@maxLength(16)
param prefix string = 'axiocred'
param location string = resourceGroup().location
param image string
param mysqlAdministratorLogin string = 'axiocredadmin'
@secure()
param mysqlAdministratorPassword string
param minReplicas int = 1
param maxReplicas int = 3

var suffix = uniqueString(resourceGroup().id)
var mysqlName = '${prefix}-mysql-${suffix}'
var storageName = take('ax${replace(prefix, '-', '')}${suffix}', 24)
var databaseName = 'axiocred'
var mysqlUrl = 'mysql://${mysqlAdministratorLogin}:${uriComponent(mysqlAdministratorPassword)}@${mysqlName}.mysql.database.azure.com:3306/${databaseName}?ssl-mode=REQUIRED'

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs-${suffix}'
  location: location
  properties: {
    retentionInDays: 30
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-env-${suffix}'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource mysql 'Microsoft.DBforMySQL/flexibleServers@2024-12-30' = {
  name: mysqlName
  location: location
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    administratorLogin: mysqlAdministratorLogin
    administratorLoginPassword: mysqlAdministratorPassword
    version: '8.0.21'
    availabilityZone: '1'
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    storage: { storageSizeGB: 32, autoGrow: 'Enabled' }
    network: { publicNetworkAccess: 'Enabled' }
  }
}

resource database 'Microsoft.DBforMySQL/flexibleServers/databases@2024-12-30' = {
  parent: mysql
  name: databaseName
  properties: { charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' }
}

resource allowAzure 'Microsoft.DBforMySQL/flexibleServers/firewallRules@2024-12-30' = {
  parent: mysql
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource evidence 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: evidence
  name: 'default'
  properties: { deleteRetentionPolicy: { enabled: true, days: 30 } }
}

resource evidenceContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'evidence'
  properties: { publicAccess: 'None' }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${prefix}-app-${suffix}'
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    environmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 8080, transport: 'auto', allowInsecure: false }
      #disable-next-line use-secure-value-for-secure-inputs
      secrets: [{ name: 'mysql-url', value: mysqlUrl }]
    }
    template: {
      containers: [{
        name: 'web'
        image: image
        env: [
          { name: 'PORT', value: '8080' }
          { name: 'DATA_MODE', value: 'mysql' }
          { name: 'MYSQL_URL', secretRef: 'mysql-url' }
          { name: 'AZURE_STORAGE_ACCOUNT', value: evidence.name }
          { name: 'GOOGLE_CLIENT_ID', value: 'placeholder.apps.googleusercontent.com' }
          { name: 'PAYPAL_CLIENT_ID', value: 'placeholder' }
        ]
        resources: { cpu: json('0.5'), memory: '1Gi' }
        probes: [
          { type: 'liveness', httpGet: { path: '/api/health', port: 8080 }, initialDelaySeconds: 10, periodSeconds: 30, failureThreshold: 3 }
          { type: 'readiness', httpGet: { path: '/api/ready', port: 8080 }, initialDelaySeconds: 5, periodSeconds: 10, failureThreshold: 3 }
        ]
      }]
      scale: { minReplicas: minReplicas, maxReplicas: maxReplicas }
    }
  }
}

resource evidenceAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(evidence.id, app.id, 'Storage Blob Data Contributor')
  scope: evidence
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output applicationUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output mysqlHost string = mysql.properties.fullyQualifiedDomainName
output evidenceStorageAccount string = evidence.name
