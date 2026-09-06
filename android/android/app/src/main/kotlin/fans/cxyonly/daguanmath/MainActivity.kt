package fans.cxyonly.daguanmath

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.BitmapFactory
import android.graphics.pdf.PdfDocument
import android.provider.DocumentsContract
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.OutputStreamWriter
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class MainActivity : FlutterActivity() {
    private val channelName = "daguan.local/storage"
    private val pencilDoubleClickAction =
        "com.oplus.ipemanager.action.PENCIL_DOUBLE_CLICK"
    private val exportRequestCode = 4107
    private val importRequestCode = 4108
    private val batchExportRequestCode = 4109
    private val batchFolderRequestCode = 4110
    private lateinit var methodChannel: MethodChannel
    private var pencilReceiverRegistered = false
    private var pendingJson: String? = null
    private var pendingBytes: ByteArray? = null
    private var pendingResult: MethodChannel.Result? = null
    private var pendingBatchName: String? = null
    private var pendingBatchMode: String? = null
    private var pendingBatchFormat: String? = null
    private var pendingBatchFiles: List<BatchFile> = emptyList()
    @Volatile private var batchProcessing = false
    private val batchCancelled = AtomicBoolean(false)

    private data class BatchFile(
        val relativePath: String,
        val filePath: String,
    )
    private val pencilReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == pencilDoubleClickAction) {
                methodChannel.invokeMethod("pencilDoubleClick", null)
            }
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        methodChannel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            channelName
        )
        methodChannel.setMethodCallHandler { call, result ->
            when (call.method) {
                "getFilesDir" -> result.success(filesDir.absolutePath)
                "exportJson" -> startExport(call, result)
                "exportCanvas" -> startCanvasExport(call, result)
                "exportBatch" -> startBatchExport(call, result)
                "cancelBatchExport" -> {
                    batchCancelled.set(true)
                    result.success(null)
                }
                "importJson" -> startImport(result)
                else -> result.notImplemented()
            }
        }
        registerPencilReceiver()
    }

    private fun registerPencilReceiver() {
        if (pencilReceiverRegistered) return
        val filter = IntentFilter(pencilDoubleClickAction)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(pencilReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(pencilReceiver, filter)
        }
        pencilReceiverRegistered = true
    }

    override fun onDestroy() {
        if (pencilReceiverRegistered) {
            unregisterReceiver(pencilReceiver)
            pencilReceiverRegistered = false
        }
        super.onDestroy()
    }

    private fun startCanvasExport(call: MethodCall, result: MethodChannel.Result) {
        if (pendingResult != null || batchProcessing) {
            result.error("busy", "已有导出窗口正在等待处理", null)
            return
        }
        val png = call.argument<ByteArray>("png")
        val pdf = call.argument<Boolean>("pdf") ?: false
        val suggestedName = call.argument<String>("name")
            ?: if (pdf) "大观园手写笔记.pdf" else "大观园手写笔记.png"
        if (png == null) {
            result.error("invalid_data", "没有可导出的画布图像", null)
            return
        }
        try {
            pendingBytes = if (pdf) pngToPdf(png) else png
        } catch (error: Exception) {
            result.error("encode_failed", error.message, null)
            return
        }
        pendingResult = result
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = if (pdf) "application/pdf" else "image/png"
            putExtra(Intent.EXTRA_TITLE, suggestedName)
        }
        startActivityForResult(intent, exportRequestCode)
    }

    private fun startBatchExport(call: MethodCall, result: MethodChannel.Result) {
        if (pendingResult != null || batchProcessing) {
            result.error("busy", "已有导出窗口正在等待处理", null)
            return
        }
        val mode = call.argument<String>("mode")
        val format = call.argument<String>("format")
        val name = call.argument<String>("name")
        val rawFiles = call.argument<List<*>>("files") ?: emptyList<Any>()
        val files = rawFiles.mapNotNull { raw ->
            val map = raw as? Map<*, *> ?: return@mapNotNull null
            val relativePath = map["relativePath"] as? String
                ?: return@mapNotNull null
            val filePath = map["filePath"] as? String ?: return@mapNotNull null
            BatchFile(relativePath, filePath)
        }
        if (mode !in setOf("zip", "folder", "mergedPdf") ||
            format !in setOf("png", "pdf") ||
            name.isNullOrBlank() ||
            files.isEmpty()
        ) {
            result.error("invalid_data", "批量导出参数不完整", null)
            return
        }
        pendingBatchName = name
        pendingBatchMode = mode
        pendingBatchFormat = format
        pendingBatchFiles = files
        batchCancelled.set(false)
        pendingResult = result
        val intent = if (mode == "folder") {
            Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
        } else {
            Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = if (mode == "mergedPdf") {
                    "application/pdf"
                } else {
                    "application/zip"
                }
                putExtra(Intent.EXTRA_TITLE, name)
            }
        }
        startActivityForResult(
            intent,
            if (mode == "folder") batchFolderRequestCode else batchExportRequestCode,
        )
    }

    private fun pngToPdf(png: ByteArray): ByteArray {
        val bitmap = BitmapFactory.decodeByteArray(png, 0, png.size)
            ?: throw IllegalArgumentException("无法读取画布图像")
        val document = PdfDocument()
        val pageInfo = PdfDocument.PageInfo.Builder(
            bitmap.width,
            bitmap.height,
            1
        ).create()
        val page = document.startPage(pageInfo)
        page.canvas.drawBitmap(bitmap, 0f, 0f, null)
        document.finishPage(page)
        val output = ByteArrayOutputStream()
        document.writeTo(output)
        document.close()
        bitmap.recycle()
        return output.toByteArray()
    }

    private fun startExport(call: MethodCall, result: MethodChannel.Result) {
        if (pendingResult != null || batchProcessing) {
            result.error("busy", "已有导出窗口正在等待处理", null)
            return
        }
        val json = call.argument<String>("json")
        val suggestedName = call.argument<String>("name") ?: "大观园题库进度.json"
        if (json == null) {
            result.error("invalid_data", "没有可导出的数据", null)
            return
        }
        pendingJson = json
        pendingResult = result
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/json"
            putExtra(Intent.EXTRA_TITLE, suggestedName)
        }
        startActivityForResult(intent, exportRequestCode)
    }

    private fun startImport(result: MethodChannel.Result) {
        if (pendingResult != null || batchProcessing) {
            result.error("busy", "已有文件窗口正在等待处理", null)
            return
        }
        pendingResult = result
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/json"
            putExtra(
                Intent.EXTRA_MIME_TYPES,
                arrayOf("application/json", "text/json", "text/plain")
            )
        }
        startActivityForResult(intent, importRequestCode)
    }

    @Deprecated("Deprecated in Android")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != exportRequestCode &&
            requestCode != importRequestCode &&
            requestCode != batchExportRequestCode &&
            requestCode != batchFolderRequestCode
        ) return
        val result = pendingResult
        val json = pendingJson
        val bytes = pendingBytes
        val batchName = pendingBatchName
        val batchMode = pendingBatchMode
        val batchFormat = pendingBatchFormat
        val batchFiles = pendingBatchFiles
        pendingResult = null
        pendingJson = null
        pendingBytes = null
        pendingBatchName = null
        pendingBatchMode = null
        pendingBatchFormat = null
        pendingBatchFiles = emptyList()
        if (resultCode != Activity.RESULT_OK || data?.data == null) {
            result?.success(null)
            return
        }
        if (requestCode == batchExportRequestCode ||
            requestCode == batchFolderRequestCode
        ) {
            batchProcessing = true
            val destination = data.data!!
            Thread {
                try {
                    when (batchMode) {
                        "zip" -> writeBatchZip(
                            destination,
                            batchFiles,
                            batchFormat ?: "png",
                        )
                        "folder" -> writeBatchFolder(
                            destination,
                            batchName ?: "大观园数学题库导出",
                            batchFiles,
                            batchFormat ?: "png",
                        )
                        "mergedPdf" -> writeMergedPdf(destination, batchFiles)
                        else -> throw IllegalArgumentException("未知批量导出方式")
                    }
                    runOnUiThread {
                        batchProcessing = false
                        result?.success(
                            if (batchCancelled.get()) null else destination.toString()
                        )
                    }
                } catch (error: Exception) {
                    runOnUiThread {
                        batchProcessing = false
                        if (batchMode != "folder") {
                            try {
                                DocumentsContract.deleteDocument(
                                    contentResolver,
                                    destination,
                                )
                            } catch (_: Exception) {
                                // Some providers remove incomplete documents themselves.
                            }
                        }
                        if (batchCancelled.get()) {
                            result?.success(null)
                        } else {
                            result?.error("write_failed", error.message, null)
                        }
                    }
                }
            }.start()
            return
        }
        if (requestCode == importRequestCode) {
            try {
                val content = contentResolver.openInputStream(data.data!!)?.use { stream ->
                    stream.bufferedReader(Charsets.UTF_8).use { reader ->
                        reader.readText()
                    }
                } ?: throw IllegalStateException("无法打开所选文件")
                result?.success(content)
            } catch (error: Exception) {
                result?.error("read_failed", error.message, null)
            }
            return
        }
        try {
            contentResolver.openOutputStream(data.data!!)?.use { stream ->
                if (bytes != null) {
                    stream.write(bytes)
                } else {
                    OutputStreamWriter(stream, Charsets.UTF_8).use { writer ->
                        writer.write(json ?: "")
                    }
                }
            } ?: throw IllegalStateException("无法打开目标文件")
            result?.success(data.data.toString())
        } catch (error: Exception) {
            result?.error("write_failed", error.message, null)
        }
    }

    private fun checkBatchCancelled() {
        if (batchCancelled.get()) throw InterruptedException("批量导出已取消")
    }

    private fun writeBatchZip(
        destination: android.net.Uri,
        files: List<BatchFile>,
        format: String,
    ) {
        contentResolver.openOutputStream(destination)?.use { stream ->
            ZipOutputStream(stream.buffered()).use { zip ->
                for (item in files) {
                    checkBatchCancelled()
                    zip.putNextEntry(ZipEntry(item.relativePath))
                    if (format == "pdf") {
                        zip.write(pngToPdf(File(item.filePath).readBytes()))
                    } else {
                        FileInputStream(item.filePath).use { input ->
                            input.copyTo(zip)
                        }
                    }
                    zip.closeEntry()
                }
            }
        } ?: throw IllegalStateException("无法打开目标文件")
    }

    private fun writeMergedPdf(
        destination: android.net.Uri,
        files: List<BatchFile>,
    ) {
        val document = PdfDocument()
        try {
            files.forEachIndexed { index, item ->
                checkBatchCancelled()
                val bitmap = BitmapFactory.decodeFile(item.filePath)
                    ?: throw IllegalArgumentException("无法读取画布图像")
                val pageInfo = PdfDocument.PageInfo.Builder(
                    bitmap.width,
                    bitmap.height,
                    index + 1,
                ).create()
                val page = document.startPage(pageInfo)
                page.canvas.drawBitmap(bitmap, 0f, 0f, null)
                document.finishPage(page)
                bitmap.recycle()
            }
            contentResolver.openOutputStream(destination)?.use { output ->
                document.writeTo(output)
            } ?: throw IllegalStateException("无法打开目标文件")
        } finally {
            document.close()
        }
    }

    private fun writeBatchFolder(
        treeUri: android.net.Uri,
        rootName: String,
        files: List<BatchFile>,
        format: String,
    ) {
        val rootDocument = DocumentsContract.buildDocumentUriUsingTree(
            treeUri,
            DocumentsContract.getTreeDocumentId(treeUri),
        )
        val exportRoot = DocumentsContract.createDocument(
            contentResolver,
            rootDocument,
            DocumentsContract.Document.MIME_TYPE_DIR,
            rootName,
        ) ?: throw IllegalStateException("无法创建导出文件夹")
        try {
            val directories = mutableMapOf("" to exportRoot)
            for (item in files) {
                checkBatchCancelled()
                val segments = item.relativePath.split("/").filter { it.isNotBlank() }
                var currentPath = ""
                var parent = exportRoot
                for (segment in segments.dropLast(1)) {
                    val nextPath = if (currentPath.isEmpty()) segment
                        else "$currentPath/$segment"
                    parent = directories[nextPath] ?: DocumentsContract.createDocument(
                        contentResolver,
                        parent,
                        DocumentsContract.Document.MIME_TYPE_DIR,
                        segment,
                    )?.also { directories[nextPath] = it }
                    ?: throw IllegalStateException("无法创建导出目录")
                    currentPath = nextPath
                }
                val fileName = segments.lastOrNull()
                    ?: throw IllegalArgumentException("导出文件名为空")
                val mime = if (format == "pdf") "application/pdf" else "image/png"
                val target = DocumentsContract.createDocument(
                    contentResolver,
                    parent,
                    mime,
                    fileName,
                ) ?: throw IllegalStateException("无法创建导出文件")
                contentResolver.openOutputStream(target)?.use { output ->
                    if (format == "pdf") {
                        output.write(pngToPdf(File(item.filePath).readBytes()))
                    } else {
                        FileInputStream(item.filePath).use { input ->
                            input.copyTo(output)
                        }
                    }
                } ?: throw IllegalStateException("无法写入导出文件")
            }
        } catch (error: Exception) {
            try {
                DocumentsContract.deleteDocument(contentResolver, exportRoot)
            } catch (_: Exception) {
                // The provider may not support deleting a created tree.
            }
            throw error
        }
    }
}
