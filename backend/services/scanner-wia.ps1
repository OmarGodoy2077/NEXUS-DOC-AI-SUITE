# ============================================================
# scanner-wia.ps1
# Puente WIA (Windows Image Acquisition) para NEXUS DOC AI SUITE
#
# Modo "list":     lista scanners disponibles (USB + red)
# Modo "scan":     escanea un documento desde un scanner específico
#
# Llamado desde Node.js (backend/services/scannerService.js).
# Salida en JSON por stdout para parseo programático.
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("list","scan")]
    [string]$Mode,

    [string]$DeviceId = "",
    [string]$OutputPath = "",
    [ValidateRange(75, 600)]
    [int]$Dpi = 200,
    [ValidateSet("Color","Grayscale","BW")]
    [string]$ColorMode = "Color"
)

$ErrorActionPreference = "Stop"

# Salida JSON estructurada
function Write-JsonResult {
    param([hashtable]$Result)
    $json = $Result | ConvertTo-Json -Depth 6 -Compress
    Write-Output $json
}

function Write-JsonError {
    param([string]$Message, [string]$Code = "ERROR")
    Write-JsonResult @{ success = $false; error = $Message; code = $Code }
    exit 1
}

try {
    $deviceManager = New-Object -ComObject WIA.DeviceManager
} catch {
    Write-JsonError "No se pudo inicializar WIA. Asegúrate de tener Windows Image Acquisition habilitado." "WIA_INIT_FAILED"
}

# ── MODO LIST ──────────────────────────────────────────────────
if ($Mode -eq "list") {
    $scanners = @()
    foreach ($info in $deviceManager.DeviceInfos) {
        # Tipo 1 = Scanner, 2 = Camera, 3 = Video
        if ($info.Type -ne 1) { continue }

        $manufacturer = ""
        $name = ""
        $description = ""

        foreach ($prop in $info.Properties) {
            switch ($prop.Name) {
                "Manufacturer" { $manufacturer = $prop.Value }
                "Name"         { $name = $prop.Value }
                "Description"  { $description = $prop.Value }
            }
        }

        $scanners += @{
            id           = $info.DeviceID
            name         = if ($name) { $name } else { $description }
            manufacturer = $manufacturer
            description  = $description
        }
    }

    Write-JsonResult @{
        success  = $true
        count    = $scanners.Count
        scanners = $scanners
    }
    exit 0
}

# ── MODO SCAN ──────────────────────────────────────────────────
if ($Mode -eq "scan") {
    if (-not $DeviceId) {
        Write-JsonError "DeviceId requerido para escanear" "MISSING_DEVICE_ID"
    }
    if (-not $OutputPath) {
        Write-JsonError "OutputPath requerido para escanear" "MISSING_OUTPUT_PATH"
    }

    # Buscar el dispositivo
    $deviceInfo = $null
    foreach ($info in $deviceManager.DeviceInfos) {
        if ($info.DeviceID -eq $DeviceId) {
            $deviceInfo = $info
            break
        }
    }
    if (-not $deviceInfo) {
        Write-JsonError "Scanner con ID '$DeviceId' no encontrado" "DEVICE_NOT_FOUND"
    }

    try {
        $device = $deviceInfo.Connect()
    } catch {
        Write-JsonError "No se pudo conectar al scanner: $($_.Exception.Message)" "CONNECT_FAILED"
    }

    $item = $device.Items.Item(1)

    # Configurar propiedades del scan
    # WIA Property IDs (well-known):
    #   6146 = Current Intent (1=Color, 2=Grayscale, 4=BW)
    #   6147 = Horizontal Resolution (DPI)
    #   6148 = Vertical Resolution (DPI)
    #   6149 = Horizontal Start Position
    #   6150 = Vertical Start Position
    #   6151 = Horizontal Extent
    #   6152 = Vertical Extent
    #   4104 = Bits Per Pixel

    $intentValue = switch ($ColorMode) {
        "Color"     { 1 }
        "Grayscale" { 2 }
        "BW"        { 4 }
    }

    function Set-WiaProperty {
        param($PropertyCollection, [int]$PropertyId, $Value)
        foreach ($prop in $PropertyCollection) {
            if ($prop.PropertyID -eq $PropertyId) {
                $prop.Value = $Value
                return $true
            }
        }
        return $false
    }

    try {
        Set-WiaProperty $item.Properties 6146 $intentValue | Out-Null
        Set-WiaProperty $item.Properties 6147 $Dpi | Out-Null
        Set-WiaProperty $item.Properties 6148 $Dpi | Out-Null
    } catch {
        # Si el scanner no soporta alguna propiedad, seguimos con las defaults
    }

    # FormatID WIA: JPEG = {B96B3CAE-0728-11D3-9D7B-0000F81EF32E}
    $formatJpg = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}"

    try {
        $image = $item.Transfer($formatJpg)
    } catch {
        Write-JsonError "Error durante la captura: $($_.Exception.Message)" "TRANSFER_FAILED"
    }

    # Guardar el archivo
    if (Test-Path $OutputPath) {
        Remove-Item $OutputPath -Force -ErrorAction SilentlyContinue
    }

    try {
        $image.SaveFile($OutputPath)
    } catch {
        Write-JsonError "No se pudo guardar el archivo: $($_.Exception.Message)" "SAVE_FAILED"
    }

    if (-not (Test-Path $OutputPath)) {
        Write-JsonError "El archivo no se generó" "FILE_NOT_CREATED"
    }

    $fileInfo = Get-Item $OutputPath
    Write-JsonResult @{
        success     = $true
        path        = $OutputPath
        size_bytes  = $fileInfo.Length
        dpi         = $Dpi
        color_mode  = $ColorMode
    }
    exit 0
}
