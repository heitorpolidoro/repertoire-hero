'use client'

import type { TabLibraryController } from '@/lib/tabLibrary'
import { TabList } from './TabList'
import { TabViewer } from './TabViewer'
import { TabUploadForm } from './TabUploadForm'

export interface TabLibrarySectionProps {
  library: TabLibraryController
  /** True while the member's own entry (and its tabs) are still loading. */
  loadingPersonal: boolean
  /** Opens PDF Stage Mode, which is still page state. */
  onOpenStage: () => void
}

/** The whole "Tabs (PDF)" section: the list, the embedded viewer and the upload form. */
export function TabLibrarySection({ library, loadingPersonal, onOpenStage }: TabLibrarySectionProps) {
  return (
    <section aria-label="Tabs" className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Tabs (PDF)</h2>

      {library.tabs.length > 0 ? (
        <div className="flex flex-col gap-4">
          <TabList
            tabs={library.tabs}
            activeTabUrl={library.activeTabUrl}
            onSelect={library.selectTab}
            onDelete={library.requestDelete}
          />
          <TabViewer
            url={library.activeTabUrl}
            title={library.activeTabTitle}
            onOpenStage={onOpenStage}
            onClose={library.closeActiveTab}
          />
        </div>
      ) : loadingPersonal ? (
        <div className="flex flex-col gap-2 animate-pulse" aria-busy="true" aria-label="Loading tabs...">
          {[1, 2].map(i => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="w-5 h-5 rounded bg-gray-200 shrink-0" />
              <div className="h-3.5 rounded bg-gray-200 flex-1 max-w-[180px]" />
              <div className="h-4 w-14 rounded-full bg-gray-200 ml-auto" />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500 bg-gray-100/60 border border-gray-200/50 rounded-xl p-4 text-center">No PDFs uploaded yet.</p>
      )}

      <TabUploadForm
        title={library.uploadTitle}
        file={library.uploadFile}
        uploading={library.uploading}
        error={library.uploadError}
        inputRef={library.fileInputRef}
        onTitleChange={library.setUploadTitle}
        onFileChange={library.pickFile}
        onSubmit={library.submitUpload}
      />
    </section>
  )
}
