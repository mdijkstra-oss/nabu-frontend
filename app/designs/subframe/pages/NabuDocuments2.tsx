"use client"

import React from "react"
import { DefaultPageLayout } from "~/ui/layouts/DefaultPageLayout"
import { FileImportView } from "~/ui/components/import/FileImportView"

function NabuDocuments2() {
  return (
    <DefaultPageLayout>
      <FileImportView />
    </DefaultPageLayout>
  )
}

export default NabuDocuments2
