packer {
  required_plugins {
    tart = {
      version = ">= 1.19.0"
      source  = "github.com/cirruslabs/tart"
    }
  }
}

variable "vm_base_name" {
  type    = string
  default = "ghcr.io/cirruslabs/alpine:latest"
}

variable "vm_name" {
  type    = string
  default = "tidepool-alpine"
}

variable "cpu_count" {
  type    = number
  default = 2
}

variable "memory_gb" {
  type    = number
  default = 4
}

variable "disk_size_gb" {
  type    = number
  default = 12
}

variable "ssh_username" {
  type    = string
  default = "admin"
}

variable "ssh_password" {
  type    = string
  default = "admin"
}

source "tart-cli" "alpine" {
  vm_base_name = var.vm_base_name
  vm_name      = var.vm_name
  cpu_count    = var.cpu_count
  memory_gb    = var.memory_gb
  disk_size_gb = var.disk_size_gb

  ssh_username = var.ssh_username
  ssh_password = var.ssh_password
  ssh_timeout  = "15m"
}

build {
  sources = ["source.tart-cli.alpine"]

  provisioner "shell" {
    script = "${path.root}/scripts/alpine-setup.sh"
    environment_vars = [
      "TIDEPOOL_WORKSPACE_NAME=test"
    ]
  }
}
