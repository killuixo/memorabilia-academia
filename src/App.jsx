import React, { useState, useEffect, useRef } from 'react';

export default function App() {
  const GOOGLE_SCRIPT_URL = import.meta.env.VITE_GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbyjyMRiQVq4VJDHiJQT1t0kFL0pWyNmieJesQt9TqRD-rw6QFBEKjrr9KHh662ABw3s/exec';

  const [activeTab, setActiveTab] = useState('registro'); // 'registro' ou 'acervo'
  const [items, setItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: 'Data/Hora', direction: 'desc' });
  const [loadingList, setLoadingList] = useState(false);

  const initialFormState = {
    pacote: '', idItem: '', centro: '', departamento: '',
    estudante1: '', estudante2: '', estudante3: '', orientador: '',
    curso: '', mesAno: '', codigo: '', observacoes: ''
  };

  const [formData, setFormData] = useState(initialFormState);
  const [status, setStatus] = useState('idle');
  const [showConfirm, setShowConfirm] = useState(false);
  
  const [ocrStatus, setOcrStatus] = useState('idle'); // idle, loading, success, error
  const fileInputRef = useRef(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const loadTesseract = () => {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve(window.Tesseract);
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.onload = () => resolve(window.Tesseract);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };

  const getSigla = (nome) => {
    if(!nome) return 'XXX';
    const ignore = ['de', 'da', 'do', 'das', 'dos', 'e', 'departamento', 'centro', '-'];
    let cleanName = nome.toLowerCase().replace(/departamento de /g, '').replace(/centro de /g, '');
    return cleanName.split(' ')
      .filter(w => !ignore.includes(w) && w.length > 0)
      .map(w => w[0])
      .join('')
      .toUpperCase()
      .substring(0, 3) || 'XXX';
  };

  const calculateNextIds = (prefixoPacote, siglaDept) => {
    let maxPacote = 0;
    let maxItem = 0;

    items.forEach(item => {
      const pct = item["ID Pacote"] || '';
      if (pct.toUpperCase().startsWith(prefixoPacote.toUpperCase())) {
        const num = parseInt(pct.replace(/\D/g, ''), 10);
        if (!isNaN(num) && num > maxPacote) maxPacote = num;
      }

      const id = item["ID Item"] || '';
      const prefixoItem = `REL-${siglaDept.toUpperCase()}-`;
      if (id.toUpperCase().startsWith(prefixoItem)) {
        const parts = id.split('-');
        if (parts.length >= 3) {
          const num = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(num) && num > maxItem) maxItem = num;
        }
      }
    });

    const nextPacote = `${prefixoPacote.toUpperCase()}${String(maxPacote + 1).padStart(3, '0')}`;
    const nextIdItem = `REL-${siglaDept.toUpperCase()}-${String(maxItem + 1).padStart(3, '0')}`;

    return { nextPacote, nextIdItem };
  };

  const parseOCR = (text) => {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2);
    let novoCentro = '', novoDept = '', novoCurso = '', novoOrientador = '', mesAno = '';
    let estudantes = [];
    let lendoEstudantes = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();

      if (lower.includes('centro de') && !novoCentro) novoCentro = line;
      if (lower.includes('departamento de') && !novoDept) novoDept = line;
      
      if ((lower.includes('disciplina:') || lower.includes('curso de')) && !novoCurso) {
        novoCurso = line.replace(/(disciplina:|curso de)\s*/i, '').trim();
      }
      
      if ((lower.includes('prof') || lower.includes('orientador')) && !novoOrientador) {
        novoOrientador = line.replace(/(prof(essor)?(a)?(.)?|orientador(a)?)\s*:?/i, '').trim();
      }

      const matchDate = lower.match(/(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro).*?(20\d{2}|19\d{2})/);
      if (matchDate && !mesAno) {
        const monthMap = {janeiro:'01', fevereiro:'02', 'março':'03', marco:'03', abril:'04', maio:'05', junho:'06', julho:'07', agosto:'08', setembro:'09', outubro:'10', novembro:'11', dezembro:'12'};
        mesAno = `${matchDate[2]}-${monthMap[matchDate[1]]}`;
      }
      
      if (lower.includes('acadêmico') || lower.includes('aluno') || lower.includes('discente') || lower.includes('estudante')) {
         lendoEstudantes = true;
         let nome = line.replace(/(acadêmicos|acadêmica|acadêmico|alunos|aluno|discentes|discente|estudantes|estudante)(s)?(a)?(s)?\s*:?/i, '').trim();
         if(nome) estudantes.push(nome);
         continue;
      }

      if (lendoEstudantes) {
          if (lower.includes('florianópolis') || matchDate || lower.includes('prof') || lower.includes('orientador')) {
              lendoEstudantes = false;
          } else if (line.length > 5) {
              estudantes.push(line);
          }
      }
    }

    return { novoCentro, novoDept, novoCurso, novoOrientador, mesAno, estudantes };
  };

  const handleImageCapture = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setOcrStatus('loading');
    try {
      const Tesseract = await loadTesseract();
      const result = await Tesseract.recognize(file, 'por');
      
      const parsed = parseOCR(result.data.text);
      const prefixoPacote = formData.pacote ? formData.pacote.replace(/[0-9-]/g, '') || 'PCT' : 'PCT';
      const sigla = getSigla(parsed.novoDept || formData.departamento || 'MEN');
      
      const { nextPacote, nextIdItem } = calculateNextIds(prefixoPacote, sigla);

      setFormData(prev => ({
        ...prev,
        pacote: prev.pacote || nextPacote,
        idItem: nextIdItem,
        centro: parsed.novoCentro || prev.centro,
        departamento: parsed.novoDept || prev.departamento,
        curso: parsed.novoCurso || prev.curso,
        orientador: parsed.novoOrientador || prev.orientador,
        mesAno: parsed.mesAno || prev.mesAno,
        estudante1: parsed.estudantes[0] || prev.estudante1,
        estudante2: parsed.estudantes[1] || prev.estudante2,
        estudante3: parsed.estudantes[2] || prev.estudante3,
      }));
      
      setOcrStatus('success');
      setTimeout(() => setOcrStatus('idle'), 4000);
    } catch (err) {
      console.error(err);
      setOcrStatus('error');
      setTimeout(() => setOcrStatus('idle'), 4000);
    }
  };

  const handlePreSubmit = (e) => {
    e.preventDefault();
    setShowConfirm(true);
  };

  const confirmAndSubmit = async () => {
    setShowConfirm(false);
    if (!GOOGLE_SCRIPT_URL) return alert("Erro: URL do Google Script ausente.");

    setStatus('loading');
    try {
      await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 
          'Content-Type': 'text/plain;charset=utf-8' 
        },
        body: JSON.stringify(formData)
      });
      
      setStatus('success');
      setFormData(initialFormState);
      fetchItems();
      setTimeout(() => setStatus('idle'), 3000);
    } catch (error) {
      console.error(error);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  const fetchItems = async () => {
    if (!GOOGLE_SCRIPT_URL) return;
    setLoadingList(true);
    try {
      const response = await fetch(GOOGLE_SCRIPT_URL);
      const data = await response.json();
      setItems(data);
    } catch (err) {
      console.error("Erro ao buscar dados:", err);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  useEffect(() => {
    if (activeTab === 'acervo') {
      fetchItems();
    }
  }, [activeTab]);

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedItems = [...items].sort((a, b) => {
    const aValue = a[sortConfig.key] ? a[sortConfig.key].toString().toLowerCase() : '';
    const bValue = b[sortConfig.key] ? b[sortConfig.key].toString().toLowerCase() : '';
    if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  return (
    <div className="min-h-screen bg-[#f4f4f0] flex flex-col items-center py-6 px-4 font-sans selection:bg-[#ffb300]">
      <div className="w-full max-w-6xl bg-white border-[12px] border-black shadow-[16px_16px_0px_0px_rgba(0,0,0,1)] flex flex-col">
        
        {/* Cabeçalho e Abas */}
        <div className="flex flex-col md:flex-row border-b-[12px] border-black">
          <div className="bg-[#c2185b] flex-1 p-6 md:p-8 text-white border-b-[12px] md:border-b-0 md:border-r-[12px] border-black">
            <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter">Acervo MEN</h1>
            <p className="mt-1 text-pink-200 font-bold text-lg">Triagem de Relatórios de Estágio</p>
          </div>
          <div className="flex flex-row md:flex-col bg-[#ffb300]">
            <button 
              onClick={() => setActiveTab('registro')}
              className={`flex-1 px-8 py-4 font-black uppercase tracking-wider text-xl border-b-[12px] md:border-r-0 border-r-[12px] border-black transition-colors ${activeTab === 'registro' ? 'bg-white text-black' : 'text-black hover:bg-[#ffe082]'}`}
            >
              Registrar
            </button>
            <button 
              onClick={() => setActiveTab('acervo')}
              className={`flex-1 px-8 py-4 font-black uppercase tracking-wider text-xl transition-colors ${activeTab === 'acervo' ? 'bg-white text-black' : 'text-black hover:bg-[#ffe082]'}`}
            >
              Acervo
            </button>
          </div>
        </div>

        {/* Conteúdo Aba: Registro */}
        {activeTab === 'registro' && (
          <div className="flex flex-col xl:flex-row">
            
            {/* Coluna do Formulário ou Resumo */}
            <div className="flex-[2] p-6 md:p-8">
              {showConfirm ? (
                <div className="flex flex-col gap-6 p-6 border-[6px] border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] animate-in fade-in zoom-in duration-300">
                  <h2 className="text-3xl font-black uppercase text-[#c2185b] mb-4 border-b-[6px] border-black pb-2">Confirmar Registro</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-sm md:text-base">
                      <div className="p-3 border-[3px] border-black bg-[#e0f7fa]"><strong className="text-black uppercase">Pacote:</strong> <br/>{formData.pacote || '-'}</div>
                      <div className="p-3 border-[3px] border-black bg-[#e0f7fa]"><strong className="text-black uppercase">ID Item:</strong> <br/>{formData.idItem || '-'}</div>
                      <div className="p-3 border-[3px] border-black bg-[#ffe082]"><strong className="text-black uppercase">Centro:</strong> <br/>{formData.centro || '-'}</div>
                      <div className="p-3 border-[3px] border-black bg-[#ffe082]"><strong className="text-black uppercase">Departamento:</strong> <br/>{formData.departamento || '-'}</div>
                      <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-[#ffe082]"><strong className="text-black uppercase">Curso/Disciplina:</strong> <br/>{formData.curso || '-'}</div>
                      <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-white"><strong className="text-black uppercase">Estudantes:</strong> <br/>{[formData.estudante1, formData.estudante2, formData.estudante3].filter(Boolean).join(', ') || '-'}</div>
                      <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-white"><strong className="text-black uppercase">Orientador(a):</strong> <br/>{formData.orientador || '-'}</div>
                      <div className="p-3 border-[3px] border-black bg-[#f8bbd0]"><strong className="text-black uppercase">Mês/Ano:</strong> <br/>{formData.mesAno || '-'}</div>
                      <div className="p-3 border-[3px] border-black bg-[#f8bbd0]"><strong className="text-black uppercase">Código SIGA:</strong> <br/>{formData.codigo || '-'}</div>
                      {formData.observacoes && <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-gray-100"><strong className="text-black uppercase">Observações:</strong> <br/>{formData.observacoes}</div>}
                  </div>
                  <div className="flex flex-col md:flex-row gap-4 mt-6">
                     <button onClick={confirmAndSubmit} className="flex-1 bg-[#00bcd4] border-[6px] border-black py-4 font-black uppercase tracking-wider text-xl hover:bg-cyan-300 active:translate-y-1 transition-transform">Confirmar e Enviar</button>
                     <button onClick={() => setShowConfirm(false)} className="flex-1 bg-[#ffb300] border-[6px] border-black py-4 font-black uppercase tracking-wider text-xl hover:bg-yellow-300 active:translate-y-1 transition-transform">Voltar e Editar</button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handlePreSubmit} className="flex flex-col gap-6">
                  
                  {/* Linha 1: Identificadores */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-black uppercase tracking-wide">Identificador do Pacote</label>
                      <input required type="text" name="pacote" value={formData.pacote} onChange={handleChange} className="w-full border-[6px] border-black p-3 text-lg font-mono focus:outline-none focus:bg-[#e0f7fa] uppercase" placeholder="Ex: PCT001" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-black uppercase tracking-wide text-[#c2185b]">ID do Item</label>
                      <input required type="text" name="idItem" value={formData.idItem} onChange={handleChange} className="w-full border-[6px] border-black p-3 text-lg font-mono focus:outline-none focus:bg-[#f8bbd0] uppercase" placeholder="Ex: REL-LLV-001" />
                    </div>
                  </div>

                  {/* Linha 2: Lotação */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-black uppercase tracking-wide text-sm">Centro (Ex: CCE)</label>
                      <input required type="text" name="centro" value={formData.centro} onChange={handleChange} className="w-full border-[6px] border-black p-3 focus:outline-none focus:bg-[#ffe082]" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-black uppercase tracking-wide text-sm">Departamento (Ex: LLV)</label>
                      <input required type="text" name="departamento" value={formData.departamento} onChange={handleChange} className="w-full border-[6px] border-black p-3 focus:outline-none focus:bg-[#ffe082]" />
                    </div>
                  </div>

                  {/* Linha 3: Estudantes */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-black uppercase tracking-wide text-sm">Estudante 1</label>
                      <input required type="text" name="estudante1" value={formData.estudante1} onChange={handleChange} className="w-full border-[6px] border-black p-3 focus:outline-none focus:bg-[#e0f7fa]" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-black uppercase tracking-wide text-sm">Estudante 2 (Opcional)</label>
                      <input type="text" name="estudante2" value={formData.estudante2} onChange={handleChange} className="w-full border-[6px] border-black p-3 focus:outline-none focus:bg-[#e0f7fa]" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-black uppercase tracking-wide text-sm">Estudante 3 (Opcional)</label>
                      <input type="text" name="estudante3" value={formData.estudante3} onChange={handleChange} className="w-full border-[6px] border-black p-3 focus:outline-none focus:bg-[#e0f7fa]" />
                    </div>
                  </div>

                  {/* Linha 4: Orientador e Curso */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-black uppercase tracking-wide">Nome do Orientador(a)</label>
                      <input required type="text" name="orientador" value={formData.orientador} onChange={handleChange} className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa]" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-black uppercase tracking-wide">Curso ou Disciplina</label>
                      <input required type="text" name="curso" value={formData.curso} onChange={handleChange} className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa]" />
                    </div>
                  </div>

                  {/* Linha 5: Detalhes IFES */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-black uppercase tracking-wide">Mês e Ano</label>
                      <input required type="month" name="mesAno" value={formData.mesAno} onChange={handleChange} className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa] bg-white uppercase font-bold" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-black uppercase tracking-wide">Código SIGA IFES</label>
                      <select required name="codigo" value={formData.codigo} onChange={handleChange} className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa] font-bold cursor-pointer appearance-none bg-white">
                        <option value="" disabled>Selecione um código...</option>
                        <option value="125.31 - Provas. Exames. Trabalhos">125.31 - Provas. Exames. Trabalhos</option>
                        <option value="125.43 - Assentamentos individuais">125.43 - Assentamentos (Dossiê)</option>
                        <option value="125.62 - Estágios não obrigatórios">125.62 - Estágios não obrigatórios</option>
                        <option value="452.32 - Estágios obrigatórios">452.32 - Estágios obrigatórios</option>
                        <option value="Outro (Especificar na observação)">Outro (Especificar na observação)</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-bold text-black uppercase tracking-wide">Observações</label>
                    <textarea name="observacoes" value={formData.observacoes} onChange={handleChange} rows="2" className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa] resize-none" />
                  </div>

                  <button type="submit" disabled={status === 'loading'} className="mt-2 w-full bg-[#c2185b] text-white border-[6px] border-black py-4 font-black text-2xl uppercase tracking-wider hover:bg-[#d81b60] active:translate-y-1 transition-all disabled:opacity-50">
                    Revisar e Salvar
                  </button>
                  {status === 'success' && <div className="bg-green-300 border-[6px] border-black p-3"><p className="text-black font-black text-center text-lg">✓ Salvo com sucesso!</p></div>}
                </form>
              )}
            </div>

            {/* Coluna do OCR (Câmera) */}
            <div className="flex-1 bg-[#00bcd4] border-t-[12px] xl:border-t-0 xl:border-l-[12px] border-black flex flex-col p-6 md:p-8">
              <h2 className="text-2xl font-black text-black uppercase tracking-tight mb-4 border-b-[6px] border-black pb-2">Assistente de Capa</h2>
              <p className="font-bold text-black mb-6 text-sm">Tire uma foto da capa do relatório. O sistema preencherá automaticamente os dados do formulário ao lado e irá gerar um identificador ID baseado na triagem prévia.</p>
              
              <input type="file" accept="image/*" capture="environment" ref={fileInputRef} onChange={handleImageCapture} className="hidden" />
              
              <button onClick={() => fileInputRef.current.click()} disabled={ocrStatus === 'loading' || showConfirm} className="bg-white text-black border-[6px] border-black py-4 font-black text-xl uppercase tracking-wider hover:bg-gray-100 flex items-center justify-center gap-3 active:translate-y-1 transition-transform mb-6 disabled:opacity-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <span className="text-3xl" role="img" aria-label="Camera">📷</span> {ocrStatus === 'loading' ? 'Lendo...' : 'Usar Câmera'}
              </button>

              {ocrStatus === 'success' && (
                <div className="bg-[#ffb300] border-[6px] border-black p-4 mt-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <p className="font-black text-black uppercase text-center text-lg">✓ Dados Preenchidos!</p>
                  <p className="text-sm font-bold text-center mt-2">Revise os campos ao lado. Selecione o código SIGA e adicione observações se necessário.</p>
                </div>
              )}
              {ocrStatus === 'error' && (
                <div className="bg-[#c2185b] border-[6px] border-black p-4 mt-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <p className="font-black text-white uppercase text-center text-lg">⚠ Erro na leitura</p>
                  <p className="text-sm font-bold text-white text-center mt-2">Não foi possível processar a imagem. Tente uma foto mais nítida.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Conteúdo Aba: Acervo */}
        {activeTab === 'acervo' && (
          <div className="p-6 md:p-8 flex flex-col bg-white overflow-hidden min-h-[500px]">
            {loadingList ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="font-black text-2xl uppercase animate-pulse">Carregando Acervo...</p>
              </div>
            ) : (
              <div className="overflow-x-auto border-[6px] border-black">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-[#ffb300] text-black">
                      {["Data/Hora", "ID Pacote", "ID Item", "Centro", "Departamento", "Estudante 1", "Orientador", "Mês/Ano", "Código IFES"].map((header) => (
                        <th 
                          key={header} 
                          onClick={() => handleSort(header)}
                          className="border-b-[6px] border-black p-4 font-black uppercase text-sm cursor-pointer hover:bg-[#ffe082] transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            {header}
                            {sortConfig.key === header && (
                              <span>{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItems.length === 0 ? (
                      <tr><td colSpan="9" className="p-6 text-center font-bold">Nenhum registro encontrado.</td></tr>
                    ) : (
                      sortedItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-gray-100 transition-colors border-b-[3px] border-gray-300 last:border-b-0">
                          <td className="p-4 font-mono text-sm">{item["Data/Hora"]}</td>
                          <td className="p-4 font-bold">{item["ID Pacote"]}</td>
                          <td className="p-4 font-bold text-[#c2185b]">{item["ID Item"]}</td>
                          <td className="p-4">{item["Centro"]}</td>
                          <td className="p-4">{item["Departamento"]}</td>
                          <td className="p-4">{item["Estudante 1"]}</td>
                          <td className="p-4">{item["Orientador"]}</td>
                          <td className="p-4 font-bold">{item["Mês/Ano"]}</td>
                          <td className="p-4 text-xs font-mono">{item["Código IFES"]}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
